import type { ReactNode } from "react";
import { PageHeader, Panel } from "../components/ui";
import { usePageMeta } from "../hooks";

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel title={title}>
      <div className="max-w-3xl space-y-3 text-[15px] leading-relaxed text-ink-2">{children}</div>
    </Panel>
  );
}

export default function PrivacyPage() {
  usePageMeta(
    "Privacy and terms",
    "What MotorScope does with uploaded recordings (processes them in memory and discards them), the absence of cookies and tracking, and the terms of use.",
  );
  return (
    <div>
      <PageHeader eyebrow="Privacy & terms" title={<>Your files, <em>analysed and forgotten</em></>} lead="No accounts, no cookies, no tracking. A recording is processed in memory, answered, and discarded." />
      <div className="space-y-4">
        <Block title="Files you upload">
          <p>
            A recording you upload is sent to the MotorScope server and analysed in memory. It isn't written to disk, kept
            after the response is sent, used to train the model, or shared with anyone.
          </p>
          <p>
            Only signal data is needed. Don't upload files that hold anything else, such as names or site details in
            column headers.
          </p>
        </Block>
        <Block title="What the server records">
          <p>
            Like most web servers, the API's access log records the time, the requested path, the response status and
            your IP address. Your IP address is also kept briefly in memory, never on disk, to enforce the rate limit.
            File contents are never logged. How long access logs are kept depends on whoever runs the server.
          </p>
        </Block>
        <Block title="Cookies, tracking and third parties">
          <p>
            MotorScope sets <strong className="text-ink">no cookies</strong>, uses no local storage, runs no analytics,
            and loads nothing from third-party services. Fonts and scripts are served from this site, so there's no cookie
            banner because there is nothing to consent to.
          </p>
        </Block>
        <Block title="Deleting your data">
          <p>
            No uploaded data or account is stored, so there's nothing to delete. For access-log entries, contact the
            operator of the server you used.
          </p>
        </Block>
        <Block title="Terms of use">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>MotorScope is a free educational demo with no accounts, payments or fees.</li>
            <li>
              Results are estimates from a model trained on a single laboratory motor and may be wrong. Don't rely on
              them for safety, maintenance or purchasing decisions.
            </li>
            <li>The software is provided as is, without warranty of any kind.</li>
            <li>Please don't try to overload or disrupt the service. Requests are rate-limited.</li>
          </ul>
        </Block>
        <p className="text-xs text-ink-3">Last updated 13 October 2026.</p>
      </div>
    </div>
  );
}
