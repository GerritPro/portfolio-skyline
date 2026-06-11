"""Parse a single SEC XBRL instance document for dimensional facts.

Given the XML bytes/string of a filing's `*_htm.xml` (post-2020 iXBRL) or
classic XBRL instance, returns a list of facts shaped as
    { concept, value, unit, period_start, period_end, dimensions: {axis: member} }

Useful for downstream pivots: revenue by ProductOrServiceAxis, by
StatementBusinessSegmentsAxis (geographic for some filers), etc.
"""
from __future__ import annotations

import io
import logging
from dataclasses import dataclass, field
from xml.etree import ElementTree as ET

log = logging.getLogger(__name__)

# Default-namespace prefix XBRL contexts live in:
NS_XBRLI = "{http://www.xbrl.org/2003/instance}"
NS_XBRLDI = "{http://xbrl.org/2006/xbrldi}"
# Common fact-concept namespaces — used to filter facts to "interesting" ones
# (revenue-related). We resolve namespaces dynamically by traversing the
# root element's nsmap-equivalent (ElementTree exposes via the element tag).
REVENUE_LOCAL_NAMES = {
    # us-gaap
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "SalesRevenueNet",
    # us-gaap operating income (segment-level)
    "OperatingIncomeLoss",
    "SegmentReportingInformationOperatingIncomeLoss",
}


@dataclass
class Context:
    cid: str
    period_start: str | None  # ISO yyyy-mm-dd (None for instant facts)
    period_end: str | None
    dimensions: dict[str, str] = field(default_factory=dict)  # axis QName → member QName


@dataclass
class Fact:
    concept: str        # local name without namespace (e.g. "Revenues")
    namespace: str      # full namespace URI (e.g. "http://fasb.org/us-gaap/2025")
    value: float
    unit: str           # e.g. "USD", "USD/shares"
    period_start: str | None
    period_end: str | None
    dimensions: dict[str, str]  # axis local-name → member local-name (no ns)


def _local(qname: str) -> str:
    """Strip namespace prefix from a QName like us-gaap:Revenues → Revenues."""
    if ":" in qname:
        return qname.rsplit(":", 1)[-1]
    return qname


def parse(xml: bytes | str) -> list[Fact]:
    """Parse the XBRL instance, return all dimensional + non-dimensional revenue/op-income facts."""
    if isinstance(xml, str):
        source = io.StringIO(xml)
    else:
        source = io.BytesIO(xml)
    tree = ET.parse(source)
    root = tree.getroot()

    # Step 1 — parse contexts.
    contexts: dict[str, Context] = {}
    for ctx in root.iter(NS_XBRLI + "context"):
        cid = ctx.attrib.get("id")
        if not cid:
            continue
        period = ctx.find(NS_XBRLI + "period")
        start: str | None = None
        end: str | None = None
        if period is not None:
            s = period.find(NS_XBRLI + "startDate")
            e = period.find(NS_XBRLI + "endDate")
            instant = period.find(NS_XBRLI + "instant")
            if s is not None and s.text:
                start = s.text.strip()
            if e is not None and e.text:
                end = e.text.strip()
            if instant is not None and instant.text:
                end = instant.text.strip()
        dims: dict[str, str] = {}
        seg = ctx.find(NS_XBRLI + "entity") and ctx.find(NS_XBRLI + "entity").find(NS_XBRLI + "segment")
        if seg is not None:
            for em in seg.findall(NS_XBRLDI + "explicitMember"):
                axis = em.attrib.get("dimension", "")
                member_text = (em.text or "").strip()
                if axis and member_text:
                    dims[_local(axis)] = _local(member_text)
        contexts[cid] = Context(cid=cid, period_start=start, period_end=end, dimensions=dims)

    # Step 2 — extract revenue + op-income facts from any namespace.
    facts: list[Fact] = []
    for el in root:
        # Skip non-facts (contexts, units, schemaRef, etc.) — facts have
        # contextRef attribute.
        ctx_ref = el.attrib.get("contextRef")
        if not ctx_ref:
            continue
        if (el.text or "").strip() == "":
            continue
        tag = el.tag
        # tag is "{ns-uri}localname"
        if not tag.startswith("{"):
            continue
        ns_uri, _, local = tag[1:].partition("}")
        if local not in REVENUE_LOCAL_NAMES:
            continue
        ctx = contexts.get(ctx_ref)
        if ctx is None:
            continue
        unit = el.attrib.get("unitRef", "")
        try:
            val = float((el.text or "").strip())
        except ValueError:
            continue
        facts.append(
            Fact(
                concept=local,
                namespace=ns_uri,
                value=val,
                unit=unit,
                period_start=ctx.period_start,
                period_end=ctx.period_end,
                dimensions=dict(ctx.dimensions),
            )
        )
    return facts


def filter_segment_facts(facts: list[Fact], axes: list[str]) -> list[Fact]:
    """Return only facts that carry one of the requested segment axes."""
    aset = set(axes)
    return [f for f in facts if any(a in f.dimensions for a in aset)]
