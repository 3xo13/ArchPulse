export default function Download({ filename = __DOWNLOAD_FILENAME__ }: { filename?: string }) {
  return filename
    ? <a className="button primary" href={`${import.meta.env.BASE_URL}downloads/${encodeURIComponent(filename)}`} download={filename}>Download for Bob <span aria-hidden="true">↓</span></a>
    : <span className="download-pending"><button className="button muted" disabled>Download coming soon</button><span>Demo available now · package added separately</span></span>;
}
