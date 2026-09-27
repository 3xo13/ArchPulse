import { useState } from "react";
export default function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [message, setMessage] = useState("");
  async function copy() {
    try { await navigator.clipboard.writeText(text); setMessage("Copied"); }
    catch { setMessage("Select the text to copy manually"); }
  }
  return <span className="copy-control"><button className="button small ghost" onClick={copy}>{label}</button><span role="status">{message}</span></span>;
}
