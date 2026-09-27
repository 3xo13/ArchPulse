import { useEffect, useState } from "react";
import Landing from "./components/Landing";
import Demo from "./demo/Demo";
export default function App() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const navigate = () => setHash(window.location.hash);
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  const demo = hash === "#/demo";
  useEffect(() => {
    document.title = demo ? "Interactive demo — ArchPulse" : "ArchPulse — Repair with evidence";
    if (hash.startsWith("#/") || !hash) window.scrollTo(0, 0);
    else document.getElementById(hash.slice(1))?.scrollIntoView?.();
  }, [hash, demo]);
  return <><a className="skip-link" href="#main" onClick={event => { event.preventDefault(); const main = document.getElementById("main"); main?.setAttribute("tabindex", "-1"); main?.focus(); }}>{demo ? "Skip to demo" : "Skip to content"}</a>{demo ? <Demo /> : <Landing />}</>;
}
