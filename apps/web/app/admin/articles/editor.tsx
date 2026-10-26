'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { cn } from '@apex/ui';
import { Button, Field, Input, Select, LightLoader, Tag, Textarea } from '@/components/ds';
import type { EditorialArticle, EditorialSummary, EditorialStatus } from '@apex/db';
import { captureEditorialAttempt, classifyEditorialRecovery, type EditorialAttempt, type EditorialRecovery } from '@/lib/article-recovery';

const SECTIONS = ['NEWS', 'FEATURE', 'ANALYSIS', 'STRATEGY', 'TECHNICAL', 'HISTORY', 'OPINION'];

export function ArticleEditor({ enabled }: { enabled: boolean }) {
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [manualSlug, setManualSlug] = useState(false);
  const [dek, setDek] = useState('');
  const [section, setSection] = useState(SECTIONS[0]);
  const [body, setBody] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string>('');
  const [savingStatus, setSavingStatus] = useState<'draft' | 'published'>('draft');
  const [saved, setSaved] = useState<EditorialArticle | null>(null);
  const [refreshPending, setRefreshPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [rows, setRows] = useState<EditorialSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pageCursor, setPageCursor] = useState<string | null>(null);
  const [previousPages, setPreviousPages] = useState<(string | null)[]>([]);
  const [listState, setListState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [listError, setListError] = useState('');
  const [listVersion, setListVersion] = useState(0);
  const [uncertainAttempt, setUncertainAttempt] = useState<EditorialAttempt | null>(null);
  const [recovery, setRecovery] = useState<EditorialRecovery | null>(null);
  const request = useRef<AbortController | null>(null);
  const creationId = useRef<string | null>(null);
  const uncertainId = uncertainAttempt?.id ?? null;
  const locked = !enabled || state === 'saving' || state === 'loading' || saved?.editable === false || uncertainId !== null;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    async function loadPage() {
      setListState('loading'); setListError('');
      try {
        const response = await fetch(`/api/articles?limit=25${pageCursor ? `&cursor=${encodeURIComponent(pageCursor)}` : ''}`, { cache: 'no-store', signal: controller.signal });
        const result = await response.json().catch(() => null) as { ok?: boolean; articles?: EditorialSummary[]; nextCursor?: string | null; error?: string } | null;
        if (!response.ok || result?.ok !== true || !Array.isArray(result.articles)) throw new Error(result?.error ?? 'Articles could not be loaded.');
        if (active) { setRows(result.articles); setNextCursor(result.nextCursor ?? null); setListState('ready'); }
      } catch (error) {
        if (active) { setListError(controller.signal.aborted ? 'Loading took too long. Please try again.' : error instanceof Error ? error.message : 'Articles could not be loaded.'); setListState('error'); }
      } finally { window.clearTimeout(timeout); }
    }
    void loadPage();
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [enabled, pageCursor, listVersion]);
  useEffect(() => () => request.current?.abort(), []);

  function refreshFirstPage() { setPageCursor(null); setPreviousPages([]); setListVersion((version) => version + 1); }
  function edited() { setDirty(true); setState('idle'); setError(''); setRefreshPending(false); }
  function applyArticle(article: EditorialArticle) {
    setSaved(article); setTitle(article.title); setSlug(article.slug); setManualSlug(true);
    setDek(article.dek ?? ''); setSection(article.section ?? ''); setBody(article.bodyMd);
    setDirty(false); setError(''); setRefreshPending(false);
  }
  function reset() {
    if (request.current || uncertainId || (dirty && !window.confirm('Discard your unsaved changes and start a new article?'))) return;
    setTitle(''); setSlug(''); setManualSlug(false); setDek(''); setBody(''); setSection(SECTIONS[0]);
    creationId.current = null;
    setSaved(null); setDirty(false); setRefreshPending(false); setError(''); setState('idle');
  }
  function inspectRecovery(stored: EditorialArticle | null) {
    if (!uncertainAttempt) return;
    const outcome = classifyEditorialRecovery(uncertainAttempt, stored);
    setRecovery(outcome); refreshFirstPage();
    if (outcome.kind === 'confirmed') {
      applyArticle(outcome.article); setUncertainAttempt(null); setRecovery(null); setState('saved');
      // Readback confirms storage, not that the interrupted cache refresh ran.
      setRefreshPending(true);
      return;
    }
    setState('error');
    setError(outcome.kind === 'not-confirmed'
      ? outcome.reason === 'missing' ? 'No saved article was found. Your attempted text is preserved. You can retry this same save using its fixed identity.'
        : 'The stored article still has the version you started with. Your attempted changes have not been confirmed and remain here. You can retry the same save safely.'
      : stored ? 'The stored article differs from your attempted save. Your text is preserved; reload the stored version only if you choose to discard your changes.'
        : 'The article could not be found. Your attempted text is preserved; saving remains blocked.');
  }
  function reloadStoredVersion() {
    if (!recovery?.article || request.current || !window.confirm('Discard your attempted changes and load the stored article?')) return;
    applyArticle(recovery.article); setUncertainAttempt(null); setRecovery(null); setState('idle');
  }
  async function openArticle(id: string, recovering = false) {
    if (request.current || (!recovering && uncertainId) || (!recovering && dirty && !window.confirm('Discard your unsaved changes and load this article?'))) return;
    const controller = new AbortController(); request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setState('loading'); setError('');
    try {
      const response = await fetch(`/api/articles?id=${encodeURIComponent(id)}`, { cache: 'no-store', signal: controller.signal });
      const result = await response.json().catch(() => null) as { ok?: boolean; article?: EditorialArticle; error?: string } | null;
      if (recovering && response.status === 404 && result?.ok === false) {
        inspectRecovery(null); return;
      }
      if (!response.ok || result?.ok !== true || !result.article?.id || !result.article.revision) throw new Error(result?.error ?? 'This article could not be loaded.');
      if (recovering) inspectRecovery(result.article);
      else { applyArticle(result.article); setState('idle'); }
    } catch (error) {
      setState('error'); setError(controller.signal.aborted ? 'Loading took too long. Your unsaved text is still here.' : error instanceof Error ? error.message : 'This article could not be loaded.');
    } finally { window.clearTimeout(timeout); if (request.current === controller) request.current = null; }
  }

  function autoSlug(t: string) {
    return t
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 100)
      .replace(/-$/g, '');
  }

  async function saveArticle(status: EditorialStatus, retrying = false) {
    if (request.current || !enabled || (retrying ? !uncertainAttempt || recovery?.kind !== 'not-confirmed' : locked)) return;
    if (!retrying && status === 'draft' && saved?.status === 'published' && !window.confirm('Return this article to draft? It will be removed from the public website after the cache refresh.')) return;
    const resolvedSlug = (slug || autoSlug(title)).trim();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(resolvedSlug)) {
      setState('error');
      setError('Use a slug of 1–100 lowercase letters, numbers or hyphens, starting and ending with a letter or number.');
      return;
    }
    if (!saved && !creationId.current) {
      try { creationId.current = crypto.randomUUID(); }
      catch { setState('error'); setError('A secure article identity could not be prepared. Please reload this page before saving.'); return; }
    }
    const attempt = retrying && uncertainAttempt ? uncertainAttempt : captureEditorialAttempt(
      saved?.id ?? creationId.current!, saved?.revision ?? null,
      { title, slug: resolvedSlug, dek, section: section ?? null, bodyMd: body, status },
    );
    setState('saving');
    setSavingStatus(attempt.input.status);
    setError('');
    const controller = new AbortController(); request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch('/api/articles', {
        method: attempt.baseRevision === null ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          id: attempt.id,
          ...(attempt.baseRevision === null ? {} : { revision: attempt.baseRevision }),
          ...attempt.input,
          dek: attempt.input.dek ?? '',
          section: attempt.input.section ?? '',
        }),
      });
      const json = await res.json().catch(() => null) as { ok?: boolean; error?: string; article?: EditorialArticle; refreshPending?: boolean; writeUncertain?: boolean } | null;
      if (!res.ok || json?.ok !== true || !json.article?.id || !json.article.revision) {
        setState('error');
        setError(json?.error ?? 'Storage could not be confirmed. Reload the article list before trying again.');
        if (!json || res.ok || json.writeUncertain === true) {
          setUncertainAttempt(attempt); setRecovery(null); refreshFirstPage();
        }
        return;
      }
      if (classifyEditorialRecovery(attempt, json.article).kind !== 'confirmed') {
        setUncertainAttempt(attempt); setRecovery(null); setState('error');
        setError('The save response does not confirm the attempted content. Your text is preserved. Check the stored article before another save.');
        refreshFirstPage(); return;
      }
      applyArticle(json.article);
      setUncertainAttempt(null); setRecovery(null);
      setRefreshPending(json.refreshPending === true);
      setState('saved');
      refreshFirstPage();
    } catch {
      setState('error');
      setUncertainAttempt(attempt); setRecovery(null); refreshFirstPage();
      setError(controller.signal.aborted ? 'The save confirmation took too long. The server may have saved it. Reload the article list before retrying.' : 'The save confirmation was interrupted. The server may have saved it. Reload the article list before retrying.');
    } finally { window.clearTimeout(timeout); if (request.current === controller) request.current = null; }
  }

  const visibilityWord = (v: EditorialSummary['visibility']) => v === 'public' ? 'Published' : v === 'draft' ? 'Draft' : v === 'scheduled' ? 'Scheduled (separate workflow)' : 'Restricted (separate workflow)';
  const busy = state === 'saving' || state === 'loading';
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;

  return (
    <div className="grid gap-10">
      <section aria-labelledby="article-list-heading" className="bg-tone-raised p-5 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 id="article-list-heading" className="font-text text-heading-s text-fg">Your articles</h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" leadingIcon="refresh" onClick={refreshFirstPage} disabled={!enabled || listState === 'loading'}>Refresh</Button>
            <Button variant="secondary" leadingIcon="plus" onClick={reset} disabled={busy || uncertainId !== null}>New article</Button>
          </div>
        </div>
        {/* Reserves the loader's height so the editor below never jumps when the list arrives. */}
        <div aria-live="polite" className="mt-4 min-h-[4.5rem]">
          {!enabled ? (
            <p className="font-text text-small text-fg-2">Article storage is not connected.</p>
          ) : listState === 'loading' || listState === 'idle' ? (
            <LightLoader message="Loading articles" />
          ) : listState === 'error' ? (
            <p role="alert" className="font-text text-small text-accent">{listError}</p>
          ) : rows.length === 0 ? (
            <p className="font-text text-small text-fg-2">No articles on this page yet. Start your first draft below.</p>
          ) : (
            <table className="w-full border-collapse font-text text-ui">
              <caption className="sr-only">Articles on this page</caption>
              <thead>
                <tr className="border-b border-rule-strong">
                  <th scope="col" className="pb-2.5 text-left text-label font-[650] uppercase text-fg-3">Title</th>
                  <th scope="col" className="hidden pb-2.5 text-left text-label font-[650] uppercase text-fg-3 md:table-cell">Status</th>
                  <th scope="col" className="hidden pb-2.5 text-left text-label font-[650] uppercase text-fg-3 lg:table-cell">Section</th>
                  <th scope="col" className="pb-2.5 text-right text-label font-[650] uppercase text-fg-3"><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((article) => (
                  <tr key={article.id} className={cn('border-b border-rule', saved?.id === article.id && 'bg-tone-hover')}>
                    <th scope="row" className="py-3 pr-4 text-left font-normal">
                      <span className="block font-[650] text-fg [overflow-wrap:anywhere]">{article.title}</span>
                      <span className="mt-0.5 block font-text text-caption text-fg-3 [overflow-wrap:anywhere]">/article/{article.slug}<span className="md:hidden"> · {visibilityWord(article.visibility)}</span></span>
                    </th>
                    <td className="hidden py-3 pr-4 align-middle md:table-cell"><Tag variant={article.visibility === 'public' ? 'inverse' : 'outline'}>{visibilityWord(article.visibility)}</Tag></td>
                    <td className="hidden py-3 pr-4 align-middle text-fg-2 lg:table-cell">{article.section || 'Unassigned'}</td>
                    <td className="py-3 text-right align-middle">
                      <Button variant="ghost" onClick={() => openArticle(article.id)} disabled={busy || uncertainId !== null}>
                        {saved?.id === article.id ? 'Reload' : article.editable ? 'Edit' : 'View'}
                        <span className="sr-only"> {article.title}</span>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {(previousPages.length > 0 || nextCursor) && (
          <div className="mt-4 flex flex-wrap justify-between gap-3">
            <Button variant="secondary" leadingIcon="arrow-left" disabled={previousPages.length === 0 || listState === 'loading'} onClick={() => { setPageCursor(previousPages.at(-1) ?? null); setPreviousPages((pages) => pages.slice(0, -1)); }}>Previous page</Button>
            <Button variant="secondary" icon="arrow-right" disabled={!nextCursor || listState !== 'ready'} onClick={() => { setPreviousPages((pages) => [...pages, pageCursor]); setPageCursor(nextCursor); }}>Next page</Button>
          </div>
        )}
      </section>

      <section aria-labelledby="editor-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 shadow-[inset_0_-1px_0_var(--rule)]">
          <h2 id="editor-heading" className="font-text text-heading-s text-fg">{saved ? 'Edit article' : 'New article'}</h2>
          {saved && <p className="font-text text-small text-fg-2">{saved.visibility === 'public' ? 'Published' : saved.visibility === 'draft' ? 'Draft' : 'Managed by a separate publishing workflow'}{dirty ? ' · Unsaved changes' : ''}</p>}
        </div>

        {uncertainId && (
          <div role="alert" className="mt-6 bg-tone-raised p-5 shadow-[inset_3px_0_0_var(--accent-text)]">
            <p className="font-text text-ui font-[650] text-fg">The save result is uncertain</p>
            <p className="mt-1 font-text text-small text-fg-2">Check the stored article before saving again. Your attempted text is preserved here.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button variant="secondary" onClick={() => openArticle(uncertainId, true)} disabled={busy} loading={state === 'loading'}>Check save status</Button>
              {recovery?.kind === 'not-confirmed' && <Button variant="secondary" onClick={() => saveArticle(uncertainAttempt!.input.status, true)} disabled={busy}>Retry this save</Button>}
              {recovery?.kind === 'conflict' && recovery.article && <Button variant="ghost" onClick={reloadStoredVersion} disabled={busy}>Discard my attempt and reload</Button>}
            </div>
          </div>
        )}
        {saved?.editable === false && <p role="status" className="mt-6 font-text text-small text-fg-2">This article has a schedule, embargo or premium restriction. Its details are shown here; this console cannot change those restrictions.</p>}

        <div className="mt-8 grid gap-7">
          <Field label="Title" hint="A clear headline, ideally under 90 characters.">
            <Input
              disabled={locked}
              maxLength={250}
              value={title}
              onChange={(e) => { setTitle(e.target.value); if (!manualSlug && !saved) setSlug(autoSlug(e.target.value)); edited(); }}
              className="text-heading-s"
            />
          </Field>
          <div className="grid gap-7 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Field label="Address" hint={saved ? 'Fixed after the first save so links keep working.' : `Will be /article/${(slug || autoSlug(title)) || 'your-headline'}. Lowercase letters, numbers and hyphens.`}>
              <Input disabled={locked || saved !== null} maxLength={100} value={slug} onChange={(e) => { setSlug(e.target.value); setManualSlug(Boolean(e.target.value)); edited(); }} spellCheck={false} autoCapitalize="none" />
            </Field>
            <Field label="Section">
              <Select disabled={locked} value={section} onChange={(e) => { setSection(e.target.value); edited(); }}>
                <option value="">Unassigned</option>
                {[...new Set([...SECTIONS, ...(section ? [section] : [])])].map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Summary" optional hint="One sentence shown under the headline.">
            <Input disabled={locked} maxLength={1000} value={dek} onChange={(e) => { setDek(e.target.value); edited(); }} />
          </Field>
          <Field label="Body" hint={`Markdown: ## for a heading, - for a list, > for a quote. ${body.length} characters, about ${Math.max(1, Math.round(words / 200))} min read.`}>
            <Textarea disabled={locked} maxLength={100000} value={body} onChange={(e) => { setBody(e.target.value); edited(); }} rows={18} />
          </Field>
        </div>

        <div className="sticky bottom-0 z-[2] -mx-4 mt-8 flex flex-wrap items-center gap-3 bg-tone px-4 py-4 shadow-[inset_0_1px_0_var(--rule)] sm:mx-0 sm:px-0">
          <Button
            onClick={() => saveArticle(saved?.status === 'published' ? 'published' : 'draft')}
            disabled={locked || !title.trim() || !body.trim() || (saved !== null && !dirty)}
            loading={state === 'saving' && savingStatus !== 'published'}
          >
            {saved?.status === 'published' ? 'Save changes' : saved ? 'Save draft' : 'Create draft'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => saveArticle(saved?.status === 'published' ? 'draft' : 'published')}
            disabled={locked || !title.trim() || !body.trim()}
            loading={state === 'saving' && savingStatus === 'published'}
          >
            {saved?.status === 'published' ? 'Return to draft' : saved ? 'Publish article' : 'Publish new article'}
          </Button>
          <div className="min-w-0 basis-full md:basis-auto md:flex-1">
            {state === 'error' && <p role="alert" className="font-text text-small text-accent [overflow-wrap:anywhere]">{error}</p>}
            {state === 'saved' && saved && (
              <p role="status" className="font-text text-small text-fg [overflow-wrap:anywhere]">
                {saved.visibility === 'public' ? <>Saved and published. <Link href={`/article/${encodeURIComponent(saved.slug)}`} className="underline underline-offset-2">Read the article</Link>.</> : saved.status === 'draft' ? 'Draft saved. It is not public.' : 'Saved. Its publication restrictions keep it off the public site.'}
                {refreshPending ? ' Storage succeeded but the public cache refresh is still pending; do not repeat this save.' : ''}
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
