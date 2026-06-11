"""Brand-color extraction + logo caching per ticker.

For each ticker, fetch a logo image (FMP stable /profile first, yfinance
fallback), cache it under /public/data/stocks/<ticker>/logo.png, then run
colorthief on it and pick a dominant colour that survives a readability
constraint (HSL Lightness 35-75%, Saturation >= 30%). Writes brand_color +
logo_path back into the same metadata.json that compute_derived already wrote.

This step is intentionally non-fatal: a ticker without a usable logo just
falls back to a sector colour at render time, no pipeline crash.
"""
from __future__ import annotations

import colorsys
import io
import logging
from pathlib import Path

import requests
from colorthief import ColorThief
from PIL import Image

from . import config
from .io_utils import read_json, write_json
from .runner import load_universe_meta

log = logging.getLogger(__name__)

FMP_STABLE_PROFILE = "https://financialmodelingprep.com/stable/profile"
SEC_USER_AGENT = "Portfolio Skyline g.ellerichmann@gmail.com"
HTTP_TIMEOUT = 10

SECTOR_FALLBACK_COLORS: dict[str, str] = {
    "Technology": "#5b8def",
    "Consumer Cyclical": "#e07a5f",
    "Communication Services": "#9b72cf",
    "Financial Services": "#3a86b3",
    "Healthcare": "#7fbf7f",
    "Industrials": "#b5895a",
    "Consumer Defensive": "#c47ab2",
    "Energy": "#d97757",
    "Utilities": "#7895c1",
    "Basic Materials": "#b58a5b",
    "Real Estate": "#9d8a6e",
}
DEFAULT_FALLBACK = "#7a7a7a"


def run() -> dict:
    config.load_env()
    api_key = config.get_fmp_key()
    universe = load_universe_meta()
    stocks_dir = config.DATA_DIR / "stocks"

    brand_map: dict[str, str] = {}
    logo_map: dict[str, str | None] = {}

    enriched = 0
    failed: list[str] = []
    for entry in universe:
        ticker = entry["ticker"]
        meta_path = stocks_dir / ticker / "metadata.json"
        if not meta_path.exists():
            continue
        metadata = read_json(meta_path, default=None) or {}
        sector = metadata.get("sector")

        try:
            logo_bytes, source_url = _fetch_logo(ticker, api_key)
        except Exception as exc:  # noqa: BLE001
            log.warning("logo fetch failed for %s: %s", ticker, exc)
            logo_bytes, source_url = None, None

        logo_rel: str | None = None
        brand_color: str | None = None
        if logo_bytes is not None:
            logo_path = stocks_dir / ticker / "logo.png"
            try:
                _save_png(logo_bytes, logo_path)
                logo_rel = f"/data/stocks/{ticker}/logo.png"
            except Exception as exc:  # noqa: BLE001
                log.warning("logo save failed for %s: %s", ticker, exc)
            try:
                brand_color = _extract_brand_color(logo_bytes)
            except Exception as exc:  # noqa: BLE001
                log.warning("colorthief failed for %s: %s", ticker, exc)

        if brand_color is None:
            brand_color = SECTOR_FALLBACK_COLORS.get(sector or "", DEFAULT_FALLBACK)
            if logo_bytes is None:
                failed.append(ticker)

        metadata["brand_color"] = brand_color
        metadata["logo_path"] = logo_rel
        write_json(meta_path, metadata)
        brand_map[ticker] = brand_color
        logo_map[ticker] = logo_rel
        log.info("%s: brand=%s logo=%s (src=%s)", ticker, brand_color, bool(logo_rel), source_url or "fallback")
        enriched += 1

    # Aggregate to a single file so the frontend can read all 500 brand colors
    # with one fs call instead of 500 sequential metadata.json reads (which
    # took ~50s/request on Windows).
    write_json(
        config.DATA_DIR / "brand_colors.json",
        {"brand": brand_map, "logo": logo_map},
    )
    return {"enriched": enriched, "without_logo": failed}


def _fetch_logo(ticker: str, api_key: str | None) -> tuple[bytes, str] | tuple[None, None]:
    """Return (logo_bytes, source_url) or (None, None). Tries FMP stable
    profile (free-tier), then the FMP CDN URL pattern directly."""
    urls: list[str] = []
    if api_key:
        try:
            r = requests.get(
                FMP_STABLE_PROFILE,
                params={"symbol": ticker, "apikey": api_key},
                timeout=HTTP_TIMEOUT,
            )
            r.raise_for_status()
            data = r.json()
            if isinstance(data, list) and data:
                img = (data[0] or {}).get("image")
                default_image = (data[0] or {}).get("defaultImage")
                if isinstance(img, str) and img and not default_image:
                    urls.append(img)
        except Exception as exc:  # noqa: BLE001
            log.debug("stable/profile failed for %s: %s", ticker, exc)
    urls.append(f"https://images.financialmodelingprep.com/symbol/{ticker}.png")

    for url in urls:
        try:
            r = requests.get(url, timeout=HTTP_TIMEOUT)
        except requests.Timeout:
            log.warning("%s: logo timeout from %s", ticker, url)
            continue
        except requests.RequestException as exc:
            log.warning("%s: logo request failed (%s) from %s", ticker, exc.__class__.__name__, url)
            continue
        if r.status_code != 200:
            log.warning("%s: logo HTTP %d from %s", ticker, r.status_code, url)
            continue
        if not r.content or len(r.content) < 200:
            log.warning("%s: logo payload too small (%d bytes) from %s", ticker, len(r.content or b""), url)
            continue
        ctype = r.headers.get("Content-Type", "")
        if "image" not in ctype:
            log.warning("%s: logo content-type %s (not image) from %s", ticker, ctype, url)
            continue
        return r.content, url
    return None, None


def _save_png(blob: bytes, dest: Path) -> None:
    img = Image.open(io.BytesIO(blob))
    if img.mode not in {"RGB", "RGBA"}:
        img = img.convert("RGBA")
    img.save(dest, format="PNG")


def _extract_brand_color(blob: bytes) -> str | None:
    """Run colorthief over the logo bytes, then walk its palette looking for
    the first colour that passes the readability constraint. Returns None if
    the logo is essentially monochrome (no palette entry has any meaningful
    saturation) — the caller will then use a neutral sector fallback rather
    than fabricate a hue out of a grayscale brand."""
    ct = ColorThief(io.BytesIO(blob))
    palette = ct.get_palette(color_count=6, quality=1)
    for rgb in palette:
        if _is_readable(rgb):
            return _rgb_to_hex(_clamp_for_readability(rgb))
    if not palette:
        return None
    # If every palette entry is essentially desaturated, the logo is
    # monochrome — don't fabricate colour, signal a fallback.
    max_sat = max(
        colorsys.rgb_to_hls(r / 255, g / 255, b / 255)[2] for r, g, b in palette
    )
    if max_sat < 0.10:
        return None
    return _rgb_to_hex(_clamp_for_readability(palette[0]))


def _is_readable(rgb: tuple[int, int, int]) -> bool:
    h, l, s = colorsys.rgb_to_hls(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)
    return 0.35 <= l <= 0.75 and s >= 0.30


def _clamp_for_readability(rgb: tuple[int, int, int]) -> tuple[int, int, int]:
    """Push the colour into the readable HSL band while keeping the hue."""
    h, l, s = colorsys.rgb_to_hls(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)
    l = min(max(l, 0.35), 0.75)
    s = max(s, 0.30)
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return (round(r * 255), round(g * 255), round(b * 255))


def _rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    return "#{:02x}{:02x}{:02x}".format(*rgb)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s", datefmt="%H:%M:%S")
    print(run())
