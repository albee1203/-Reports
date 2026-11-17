import { Component, ReactNode } from 'react';

// 單頁發生錯誤時顯示說明，不影響其他頁面及已儲存資料
export class ErrorBoundary extends Component<{ children: ReactNode; onUndo: () => void; onHome: () => void }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="card error-box">
        <h2>此頁面發生錯誤</h2>
        <p>專案資料已儲存於本機，未受影響。可先「復原」最近一次修改，或回到進度總覽。若問題持續，請下載專案備份後回報下列訊息。</p>
        <pre className="formula">{this.state.err.message}</pre>
        <div className="row">
          <button className="primary" onClick={() => { this.props.onUndo(); this.setState({ err: null }); }}>復原最近一次修改</button>
          <button onClick={() => { this.props.onHome(); this.setState({ err: null }); }}>回到進度總覽</button>
        </div>
      </div>
    );
  }
}
