// Assistant Hub (WP2.6, R-GUI4) — the honest recovery card shown when a GenUI spec exhausts the bounded
// repair loop (or is unrenderable at the root). It never pretends a widget rendered; it points the reader
// at the assistant's text answer. Token-driven `Alert` variant only (R-GUI8).

import { Alert, AlertDescription, AlertTitle } from "@elabs-ai/components-ui";

export function GenuiRecoveryCard({ reason }: { reason?: string }) {
  return (
    <Alert variant="warning" className="min-w-0">
      <AlertTitle>Couldn’t render this widget</AlertTitle>
      <AlertDescription>
        The assistant tried to render a UI widget but it didn't validate
        {reason ? ` — ${reason}` : ""}. The answer is in the assistant's message text.
      </AlertDescription>
    </Alert>
  );
}
