/**
 * "/me" My Stuff (SPEC §7.14): backstage-pass header (avatar, name, role, member since),
 * "choose a new password" banner after an admin reset, My festival (§7b), profile + password forms, and tabs for
 * my songs / my shows / my comments (GET /api/me/contributions) with edit/delete.
 * Mounted inside <RequireAuth>.
 */
import { Crown, KeyRound, Music, Ticket } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router';
import { errorMessage, getContributions } from '../api';
import { UserAvatar } from '../components/CharacterAvatar';
import { TabPanel, Tabs } from '../components/Controls';
import { ErrorState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeletons';
import { useApiData } from '../hooks/useApiData';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { formatDate } from '../lib/format';
import { useAuth } from '../state/AuthProvider';
import type { Comment, Contributions, User } from '../types';
import { CURRENT_PASSWORD_ID, PasswordForm, ProfileForm } from './me/AccountForms';
import { MyComments, MyShows, MySongs } from './me/Contributions';
import { FestivalSetting } from './me/FestivalSetting';
import './MePage.css';

type TabId = 'songs' | 'shows' | 'comments';
const TAB_IDS: readonly TabId[] = ['songs', 'shows', 'comments'];

export default function MePage() {
  useDocumentTitle('My stuff');
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: TabId = TAB_IDS.includes(tabParam as TabId) ? (tabParam as TabId) : 'songs';
  const setTab = useCallback(
    (t: TabId) => {
      const next = new URLSearchParams(params);
      if (t === 'songs') next.delete('tab');
      else next.set('tab', t);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const { data, loading, error, reload, setData } = useApiData<Contributions>((signal) => getContributions(signal), [user?.id]);
  const mustChange = Boolean(user?.mustChangePassword);

  // After an admin reset, put the cursor straight into the password form.
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!mustChange || focusedRef.current) return;
    const t = window.setTimeout(() => {
      focusedRef.current = true;
      const el = document.getElementById(CURRENT_PASSWORD_ID);
      el?.focus();
      el?.scrollIntoView?.({ block: 'center' });
    }, 50);
    return () => window.clearTimeout(t);
  }, [mustChange]);

  if (!user) return null; // RequireAuth handles the redirect

  const counts = { songs: data?.songs.length, shows: data?.shows.length, comments: data?.comments.length };

  const update = (fn: (d: Contributions) => Contributions) => setData((prev) => (prev ? fn(prev) : prev));

  return (
    <div className="container me-page">
      <PassHeader user={user} counts={counts} onPick={setTab} />

      {mustChange && (
        <div className="me-banner callout callout-warning" role="alert" data-testid="me-password-banner">
          <KeyRound size={22} aria-hidden="true" className="me-banner-icon" />
          <div className="me-banner-text">
            <strong>Your password was reset by an admin.</strong> Choose a new one now so only you can get backstage.
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              const el = document.getElementById(CURRENT_PASSWORD_ID);
              el?.focus();
              el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
            }}
          >
            Set a new password
          </button>
        </div>
      )}

      <div className={`me-layout${mustChange ? ' needs-password' : ''}`}>
        <section className="me-main" aria-labelledby="me-contrib-title">
          <h2 id="me-contrib-title" className="section-title">
            <span className="emoji" aria-hidden="true">
              🧳
            </span>
            My contributions
          </h2>
          <Tabs<TabId>
            label="My contributions"
            idPrefix="me-tab"
            active={tab}
            onChange={setTab}
            tabs={[
              { id: 'songs', label: 'Songs', badge: counts.songs, testId: 'me-tab-songs' },
              { id: 'shows', label: 'Shows', badge: counts.shows, testId: 'me-tab-shows' },
              { id: 'comments', label: 'Comments', badge: counts.comments, testId: 'me-tab-comments' },
            ]}
          />
          {TAB_IDS.map((id) => (
            <TabPanel key={id} id={id} idPrefix="me-tab" active={tab === id}>
              {error && !data ? (
                <ErrorState title="Your stuff missed its cue" message={errorMessage(error)} onRetry={reload} />
              ) : loading && !data ? (
                <ListSkeleton />
              ) : data ? (
                id === 'songs' ? (
                  <MySongs
                    songs={data.songs}
                    onDeleted={(songId) =>
                      update((d) => ({
                        ...d,
                        songs: d.songs.filter((s) => s.id !== songId),
                        comments: d.comments.filter((c) => !(c.target.type === 'song' && c.target.id === songId)),
                      }))
                    }
                  />
                ) : id === 'shows' ? (
                  <MyShows shows={data.shows} onDeleted={(showId) => update((d) => ({ ...d, shows: d.shows.filter((s) => s.id !== showId), comments: d.comments.filter((c) => !(c.target.type === 'show' && c.target.id === showId)) }))} />
                ) : (
                  <MyComments comments={data.comments} onChange={(next: Comment[]) => update((d) => ({ ...d, comments: next }))} />
                )
              ) : null}
            </TabPanel>
          ))}
        </section>

        <aside className="me-settings" aria-label="Account settings">
          <PasswordFormSlot mustChange={mustChange} />
        </aside>
      </div>
    </div>
  );
}

function PasswordFormSlot({ mustChange }: { mustChange: boolean }) {
  // When a new password is needed, that form comes first.
  return mustChange ? (
    <>
      <PasswordForm highlight />
      <FestivalSetting mustChange />
      <ProfileForm />
    </>
  ) : (
    <>
      <FestivalSetting />
      <ProfileForm />
      <PasswordForm />
    </>
  );
}

function PassHeader({ user, counts, onPick }: { user: User; counts: Partial<Record<TabId, number>>; onPick: (t: TabId) => void }) {
  const admin = user.role === 'admin';
  const stat = (id: TabId, label: string) => (
    <li>
      <button type="button" className="me-pass-stat" onClick={() => onPick(id)} data-testid={`me-count-${id}`}>
        <span className="me-pass-stat-value">{counts[id] ?? <Skeleton width={28} height={26} />}</span>
        <span className="me-pass-stat-label">{label}</span>
      </button>
    </li>
  );
  return (
    <header className={`me-pass${admin ? ' is-admin' : ''}`} data-testid="me-pass">
      <div className="me-pass-card">
        <span className="me-pass-clip" aria-hidden="true" />
        <div className="me-pass-strip">
          <span className="me-pass-strip-text">
            <Ticket size={16} aria-hidden="true" /> Backstage pass
          </span>
          <span className="me-pass-access">{admin ? 'All access' : 'Cast & crew'}</span>
        </div>
        <div className="me-pass-body">
          <div className="me-pass-photo">
            <UserAvatar name={user.displayName} size="xl" />
            {admin && (
              <span className="me-pass-crown" aria-hidden="true">
                👑
              </span>
            )}
          </div>
          <div className="me-pass-id">
            <p className="me-pass-kicker">My stuff</p>
            <h1 className="me-pass-name" data-testid="me-name">
              {user.displayName}
            </h1>
            <div className="me-pass-meta">
              {admin ? (
                <Link to="/admin" className="badge badge-gold me-role" data-testid="me-role">
                  <Crown size={13} aria-hidden="true" /> Admin
                </Link>
              ) : (
                <span className="badge badge-outline me-role" data-testid="me-role">
                  <Music size={13} aria-hidden="true" /> Member
                </span>
              )}
              <span className="me-pass-since">Member since {formatDate(user.createdAt)}</span>
            </div>
            <p className="me-pass-email">
              {user.email} <span className="me-pass-email-note">· private — only you and admins see it</span>
            </p>
          </div>
        </div>
        <ul className="me-pass-stats" role="list" aria-label="My contributions">
          {stat('songs', 'songs added')}
          {stat('shows', 'shows added')}
          {stat('comments', 'comments')}
        </ul>
        <span className="me-pass-barcode" aria-hidden="true" />
      </div>
    </header>
  );
}

function ListSkeleton() {
  return (
    <div className="me-list" role="status" aria-live="polite">
      <span className="visually-hidden">Loading your stuff…</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="me-row card" aria-hidden="true">
          <Skeleton width={72} height={72} radius={12} />
          <div className="stack stack-sm" style={{ flex: 1 }}>
            <Skeleton height={18} width="55%" />
            <Skeleton height={14} width="35%" />
            <Skeleton height={20} width="70%" />
          </div>
        </div>
      ))}
    </div>
  );
}
