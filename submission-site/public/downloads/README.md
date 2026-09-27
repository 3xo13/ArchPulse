Place your manually prepared ArchPulse source package here as `ArchPulse.rar`
(the supplied package) or `archpulse.zip`, then rebuild and redeploy the site.
A nonempty RAR takes precedence when both exist. Archives are ignored by Git.
For a Git-based Vercel deployment you must deliberately include the ZIP in the
deployment source (for example, explicitly stage that one archive), or deploy
the local site folder through Vercel CLI. Never include submission-site in the
ArchPulse installation package, or include node_modules or generated reports.
