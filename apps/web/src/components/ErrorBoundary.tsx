import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button, ErrorState } from "@brand/ui";

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { error: Error | null };

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-dvh items-center justify-center p-6">
          <ErrorState
            title="Couldn’t render this page."
            description={`${this.state.error.message} Reload the app to continue.`}
            actions={<Button onClick={() => window.location.reload()}>Reload app</Button>}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
