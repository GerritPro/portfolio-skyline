import type { ValidationIssue } from "@/lib/types";

import { SectionLabel } from "./SectionLabel";

type Props = {
  title: string;
  detail?: string;
  file?: string;
  issues?: ValidationIssue[];
  hint?: string;
};

export function ValidationError({ title, detail, file, issues, hint }: Props) {
  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-bg-primary px-6 py-12">
      <div className="w-full max-w-2xl">
        <SectionLabel className="!text-state-negative">Pipeline error</SectionLabel>
        <h1 className="display-md mt-2">{title}</h1>
        {detail ? <p className="body mt-3 text-text-secondary">{detail}</p> : null}
        {file ? (
          <p className="footnote mt-3 tabular-nums">
            file: <span className="font-medium text-text-primary">public/data/{file}</span>
          </p>
        ) : null}
        {issues && issues.length > 0 ? (
          <div className="surface-card mt-6 overflow-hidden">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="bg-bg-soft">
                  <th className="px-4 py-2.5">
                    <SectionLabel>path</SectionLabel>
                  </th>
                  <th className="px-4 py-2.5">
                    <SectionLabel>message</SectionLabel>
                  </th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {issues.map((issue, i) => (
                  <tr key={i} className="border-t divider-hairline">
                    <td className="px-4 py-2.5 text-text-secondary">{issue.path}</td>
                    <td className="px-4 py-2.5 text-text-primary">{issue.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {hint ? (
          <p className="surface-soft mt-6 p-4 caption">{hint}</p>
        ) : null}
      </div>
    </div>
  );
}
