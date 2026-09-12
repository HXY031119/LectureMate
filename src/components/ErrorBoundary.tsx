import { Component, type ErrorInfo, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo): void { console.error(error, info); }
  render(): ReactNode {
    if (this.state.failed) return <main className="fatal"><h1>LectureMate 遇到了意外问题</h1><p>你的本地数据仍然安全。请重启应用后继续使用。</p></main>;
    return this.props.children;
  }
}
