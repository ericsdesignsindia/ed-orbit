"use client";

import { useState } from "react";
import { FileUp, LoaderCircle, ScanSearch } from "lucide-react";
import type { SiteRecord, WorkspaceAction } from "@/lib/contracts";
import { parseScreamingFrogExport, type ScreamingFrogImport } from "@/lib/screaming-frog-import";

export function ScreamingFrogImportPanel({ site, busy, save }: { site: SiteRecord; busy: boolean; save: (action: WorkspaceAction) => Promise<unknown> }) {
  const [prepared, setPrepared] = useState<{ name: string; data: ScreamingFrogImport } | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function chooseFile(file?: File) {
    setError(""); setNotice(""); setPrepared(null);
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError("Choose a CSV smaller than 5 MB."); return; }
    setReading(true);
    try { setPrepared({ name: file.name, data: parseScreamingFrogExport(await file.text(), site) }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "This export could not be read."); }
    finally { setReading(false); }
  }

  async function importCrawl() {
    if (!prepared) return;
    setError(""); setNotice("");
    try {
      await save({ action: "import-screaming-frog", websiteId: site.id, crawl: prepared.data });
      setNotice(`Imported ${prepared.data.pages.length.toLocaleString()} URLs and ${prepared.data.issues.length.toLocaleString()} findings into ${site.name}.`);
      setPrepared(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The crawl could not be saved. Your existing history is unchanged."); }
  }

  return <section className="card live-panel sf-import-panel">
    <div className="live-panel-heading"><div><h2><ScanSearch size={18} />Screaming Frog SEO Spider</h2><p>Use Screaming Frog for the crawl, then bring its findings into this website’s saved SEO history.</p></div></div>
    <ol className="sf-import-steps"><li>In Screaming Frog, export <strong>Internal → All</strong> as CSV.</li><li>Choose the export below. SIGNAL checks its URLs against <strong>{site.domain}</strong> before import.</li><li>Review the preview, then import. The CSV is parsed in your browser; structured crawl data is saved to this workspace.</li></ol>
    <div className="inline-actions sf-import-actions"><label className="button secondary sf-file-picker"><FileUp size={15} />{reading ? "Reading CSV…" : "Choose Screaming Frog CSV"}<input type="file" accept=".csv,text/csv" disabled={busy || reading} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void chooseFile(file); }} /></label>{reading && <LoaderCircle size={16} className="spinning" />}</div>
    {prepared && <div className="sf-import-preview" role="status"><strong>Ready to import · {prepared.name}</strong><span>{prepared.data.pages.length.toLocaleString()} in-scope URLs · {prepared.data.issues.length.toLocaleString()} derived findings · observed score {prepared.data.score}/100</span><small>Preview score is based only on exported fields; it is not a ranking or traffic metric.</small><button className="button primary" disabled={busy} onClick={() => void importCrawl()}>{busy ? "Saving crawl…" : "Import crawl into SIGNAL"}</button></div>}
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    <p className="audit-scope">This connects Screaming Frog exports to SIGNAL; it does not run the desktop Spider on Vercel. Fields not present in the CSV are shown as unknown, not as clean.</p>
  </section>;
}
