/**
 * "/admin" (SPEC §7.15) — admins only (others see a polite "Admins only 👑" page).
 * Overview counters, then tabs: Users (roles, disable, reset password) and Comments (moderation
 * feed). Also offers the spreadsheet export. Mounted inside <RequireAuth>.
 */
import { Download, RefreshCw } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { adminListComments, adminListUsers, EXPORT_XLSX_URL, errorMessage } from '../api';
import { TabPanel, Tabs } from '../components/Controls';
import { ErrorState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeletons';
import { useApiData } from '../hooks/useApiData';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useAuth } from '../state/AuthProvider';
import { useSongs } from '../state/SongsProvider';
import type { AdminUser, Comment } from '../types';
import { CommentsPanel } from './admin/CommentsPanel';
import { UsersPanel } from './admin/UsersPanel';
import './AdminPage.css';

type TabId = 'users' | 'comments';
const PAGE = 100;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export default function AdminPage() {
  const { isAdmin, loading } = useAuth();
  useDocumentTitle(isAdmin ? 'Admin' : 'Admins only');
  if (loading) return null;
  return isAdmin ? <AdminBooth /> : <AdminsOnly />;
}

function AdminsOnly() {
  return (
    <div className="container-narrow admin-denied" data-testid="admin-denied">
      <div className="admin-denied-card card">
        <span className="admin-denied-crown emoji" aria-hidden="true">
          🔒
        </span>
        <p className="eyebrow">Stage manager’s booth</p>
        <h1 className="page-title admin-denied-title">
          Admins only <span aria-hidden="true">👑</span>
        </h1>
        <p className="admin-denied-text">
          Sorry, this door is for the stage managers who look after the site. If you think you should have access, ask your teacher or the site admin to promote your account.
        </p>
        <div className="cluster admin-denied-actions">
          <Link to="/" className="btn btn-primary">
            Back to the lobby
          </Link>
          <Link to="/me" className="btn btn-ghost">
            My stuff
          </Link>
        </div>
      </div>
    </div>
  );
}

function AdminBooth() {
  const [params, setParams] = useSearchParams();
  const tab: TabId = params.get('tab') === 'comments' ? 'comments' : 'users';
  const setTab = useCallback(
    (t: TabId) => {
      const next = new URLSearchParams(params);
      if (t === 'users') next.delete('tab');
      else next.set('tab', t);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const users = useApiData<{ users: AdminUser[] }>((signal) => adminListUsers(signal), []);
  const [limit, setLimit] = useState(PAGE);
  const comments = useApiData<{ comments: Comment[] }>((signal) => adminListComments(limit, signal), [limit]);
  const { songs } = useSongs();

  const userList = useMemo(() => users.data?.users ?? [], [users.data]);
  // Removed comments are hidden locally so "has more" still reflects the size of the server page.
  const [removedIds, setRemovedIds] = useState<ReadonlySet<number>>(() => new Set());
  const fetched = comments.data?.comments.length ?? 0;
  const pageFull = fetched >= limit;
  const commentList = useMemo(() => (comments.data?.comments ?? []).filter((c) => !removedIds.has(c.id)), [comments.data, removedIds]);

  const overview = useMemo(() => {
    const now = Date.now();
    const thisWeek = commentList.filter((c) => now - new Date(c.createdAt).getTime() < WEEK_MS).length;
    return {
      users: users.data ? userList.length : null,
      admins: users.data ? userList.filter((u) => u.role === 'admin' && !u.disabled).length : null,
      disabled: users.data ? userList.filter((u) => u.disabled).length : null,
      community: songs.filter((s) => s.source === 'community').length,
      week: comments.data ? thisWeek : null,
      weekCapped: comments.data ? thisWeek >= commentList.length && pageFull : false,
    };
  }, [users.data, userList, comments.data, commentList, songs, pageFull]);

  const refreshAll = () => {
    users.reload();
    comments.reload();
  };

  return (
    <div className="container admin-page">
      <header className="page-header admin-header">
        <div>
          <p className="eyebrow">
            <span aria-hidden="true">🎧 </span>Stage manager’s booth
          </p>
          <h1 className="page-title">
            Admin <span className="admin-title-crown" aria-hidden="true">👑</span>
          </h1>
          <p className="page-subtitle">Look after accounts, keep Backstage Chatter kind, and grab the whole song list as a spreadsheet.</p>
        </div>
        <div className="cluster admin-header-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={refreshAll} disabled={users.loading || comments.loading} data-testid="admin-refresh">
            <RefreshCw size={16} aria-hidden="true" className={users.loading || comments.loading ? 'admin-spin' : undefined} /> Refresh
          </button>
          <a href={EXPORT_XLSX_URL} download className="btn btn-primary" data-testid="admin-download-xlsx">
            <Download size={18} aria-hidden="true" /> Download spreadsheet (.xlsx)
          </a>
        </div>
      </header>

      <section aria-labelledby="admin-overview-title">
        <h2 id="admin-overview-title" className="visually-hidden">
          Overview
        </h2>
        <ul className="admin-overview" role="list" data-testid="admin-overview">
          <OverviewTile emoji="👥" label="members" value={overview.users} />
          <OverviewTile emoji="👑" label="active admins" value={overview.admins} />
          <OverviewTile emoji="🚫" label="disabled" value={overview.disabled} />
          <OverviewTile emoji="🌱" label="community songs" value={overview.community} />
          <OverviewTile emoji="💬" label="comments this week" value={overview.week} suffix={overview.weekCapped ? '+' : ''} />
        </ul>
      </section>

      <Tabs<TabId>
        label="Admin sections"
        idPrefix="admin-tab"
        active={tab}
        onChange={setTab}
        className="admin-tabs"
        tabs={[
          { id: 'users', label: 'Users', badge: users.data ? userList.length : undefined, testId: 'admin-tab-users' },
          { id: 'comments', label: 'Comments', badge: comments.data ? `${commentList.length}${pageFull ? '+' : ''}` : undefined, testId: 'admin-tab-comments' },
        ]}
      />

      <TabPanel id="users" idPrefix="admin-tab" active={tab === 'users'}>
        {users.error && !users.data ? (
          <ErrorState title="Couldn’t load the cast list" message={errorMessage(users.error)} onRetry={users.reload} />
        ) : !users.data ? (
          <PanelSkeleton label="Loading users…" />
        ) : (
          <UsersPanel users={userList} onUserChange={(u) => users.setData((prev) => (prev ? { users: prev.users.map((x) => (x.id === u.id ? u : x)) } : prev))} />
        )}
      </TabPanel>

      <TabPanel id="comments" idPrefix="admin-tab" active={tab === 'comments'}>
        {comments.error && !comments.data ? (
          <ErrorState title="Couldn’t load comments" message={errorMessage(comments.error)} onRetry={comments.reload} />
        ) : !comments.data ? (
          <PanelSkeleton label="Loading comments…" />
        ) : (
          <CommentsPanel
            comments={commentList}
            hasMore={pageFull && limit < 1000}
            loadingMore={comments.loading}
            onLoadMore={() => setLimit((l) => Math.min(1000, l + PAGE))}
            onRemoved={(id) => setRemovedIds((prev) => new Set(prev).add(id))}
          />
        )}
      </TabPanel>
    </div>
  );
}

function OverviewTile({ emoji, label, value, suffix = '' }: { emoji: string; label: string; value: number | null; suffix?: string }) {
  return (
    <li className="admin-stat card">
      <span className="admin-stat-emoji emoji" aria-hidden="true">
        {emoji}
      </span>
      <span className="admin-stat-value">{value === null ? <Skeleton width={36} height={28} /> : `${value}${suffix}`}</span>
      <span className="admin-stat-label">{label}</span>
    </li>
  );
}

function PanelSkeleton({ label }: { label: string }) {
  return (
    <div className="stack" role="status" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} height={64} radius={14} />
      ))}
    </div>
  );
}
