/**
 * Admin → Users: searchable table (cards on phones) with role / disabled switches (confirmed),
 * contribution counts, dates and "Reset password" (shows the temporary password once).
 */
import { KeyRound, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { adminResetPassword, adminUpdateUser, isApiError } from '../../api';
import { UserAvatar } from '../../components/CharacterAvatar';
import { useConfirm } from '../../components/ConfirmDialog';
import { SegmentedControl, Switch } from '../../components/Controls';
import { CopyButton } from '../../components/CopyButton';
import { EmptyState } from '../../components/EmptyState';
import { Modal } from '../../components/Modal';
import { formatDate, relativeTime } from '../../lib/format';
import { normalizeText } from '../../lib/normalize';
import { useAuth } from '../../state/AuthProvider';
import { useToast } from '../../state/ToastProvider';
import type { AdminUser, AdminUserPatch } from '../../types';

type RoleFilter = 'all' | 'admin' | 'disabled';
type SortKey = 'newest' | 'name' | 'active';

export interface UsersPanelProps {
  users: AdminUser[];
  onUserChange: (user: AdminUser) => void;
}

export function UsersPanel({ users, onUserChange }: UsersPanelProps) {
  const { user: me, refresh } = useAuth();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<RoleFilter>('all');
  const [sort, setSort] = useState<SortKey>('newest');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [temp, setTemp] = useState<TempPassword | null>(null);

  const visible = useMemo(() => {
    const needle = normalizeText(q);
    const list = users.filter((u) => {
      if (filter === 'admin' && u.role !== 'admin') return false;
      if (filter === 'disabled' && !u.disabled) return false;
      if (!needle) return true;
      return normalizeText(`${u.displayName} ${u.email}`).includes(needle);
    });
    const time = (s: string | null) => (s ? new Date(s).getTime() : 0);
    return [...list].sort((a, b) => {
      if (sort === 'name') return a.displayName.localeCompare(b.displayName, 'en', { sensitivity: 'base' });
      if (sort === 'active') return time(b.lastLoginAt) - time(a.lastLoginAt) || b.id - a.id;
      return time(b.createdAt) - time(a.createdAt) || b.id - a.id;
    });
  }, [users, q, filter, sort]);

  const counts = { admin: users.filter((u) => u.role === 'admin').length, disabled: users.filter((u) => u.disabled).length };

  const patchUser = async (u: AdminUser, patch: AdminUserPatch, success: string) => {
    setBusyId(u.id);
    try {
      const updated = await adminUpdateUser(u.id, patch);
      onUserChange({ ...u, ...updated });
      toast.success(success, { id: `user-${u.id}` });
      if (me && u.id === me.id) await refresh();
    } catch (e) {
      if (isApiError(e) && e.status === 409) toast.error(e.message, { title: 'Can’t do that', id: `user-${u.id}` });
      else toast.error(e, { id: `user-${u.id}` });
    } finally {
      setBusyId(null);
    }
  };

  const onRoleToggle = async (u: AdminUser, makeAdmin: boolean) => {
    const self = me?.id === u.id;
    const ok = await confirm(
      makeAdmin
        ? {
            title: `Make ${u.displayName} an admin?`,
            message: <p>Admins can edit or delete any song, show or comment and manage everyone’s accounts. Only promote people you trust — like a teacher.</p>,
            confirmLabel: 'Make admin',
            tone: 'primary',
          }
        : {
            title: self ? 'Step down as admin?' : `Remove ${u.displayName}’s admin powers?`,
            message: self ? <p>You’ll lose access to this page straight away. Another admin can promote you again.</p> : <p>They’ll go back to being a regular member.</p>,
            confirmLabel: 'Remove admin',
          },
    );
    if (!ok) return;
    await patchUser(u, { role: makeAdmin ? 'admin' : 'user' }, makeAdmin ? `${u.displayName} is now an admin 👑` : `${u.displayName} is no longer an admin`);
  };

  const onActiveToggle = async (u: AdminUser, active: boolean) => {
    const ok = await confirm(
      active
        ? { title: `Re-enable ${u.displayName}’s account?`, message: <p>They’ll be able to log in again.</p>, confirmLabel: 'Enable account', tone: 'primary' }
        : {
            title: `Disable ${u.displayName}’s account?`,
            message: <p>They’ll be logged out everywhere and won’t be able to log in until you switch this back on. Their songs and comments stay.</p>,
            confirmLabel: 'Disable account',
          },
    );
    if (!ok) return;
    await patchUser(u, { disabled: !active }, active ? `${u.displayName} can log in again` : `${u.displayName}’s account is disabled`);
  };

  const onReset = async (u: AdminUser) => {
    const ok = await confirm({
      title: `Reset ${u.displayName}’s password?`,
      message: (
        <p>
          This logs them out everywhere. You’ll get a <strong>temporary password</strong> to pass on — it’s shown only once.
        </p>
      ),
      confirmLabel: 'Reset password',
      tone: 'primary',
    });
    if (!ok) return;
    setBusyId(u.id);
    try {
      const { temporaryPassword, expiresAt } = await adminResetPassword(u.id);
      onUserChange({ ...u, mustChangePassword: true });
      setTemp({ user: u, password: temporaryPassword, expiresAt: expiresAt ?? null });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="admin-users">
      <div className="admin-toolbar">
        <label className="admin-search">
          <Search size={18} aria-hidden="true" />
          <span className="visually-hidden">Search users by name or email</span>
          <input type="search" className="input" placeholder="Search name or email…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="user-search" />
        </label>
        <SegmentedControl<RoleFilter>
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `All ${users.length}`, testId: 'user-filter-all' },
            { value: 'admin', label: `👑 Admins ${counts.admin}`, testId: 'user-filter-admin' },
            { value: 'disabled', label: `Disabled ${counts.disabled}`, testId: 'user-filter-disabled' },
          ]}
        />
        <label className="admin-sort">
          <span className="small muted">Sort</span>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} data-testid="user-sort">
            <option value="newest">Newest members</option>
            <option value="name">Name A–Z</option>
            <option value="active">Recently active</option>
          </select>
        </label>
      </div>

      <p className="visually-hidden" role="status" aria-live="polite">
        {visible.length} of {users.length} users shown
      </p>

      {visible.length === 0 ? (
        <EmptyState emoji="🔍" title="Nobody by that name" level={3}>
          <p>Try a different name or email, or clear the filter.</p>
        </EmptyState>
      ) : (
        <div className="admin-table-wrap">
          <table className="table admin-table" role="table" data-testid="users-table">
            <caption className="visually-hidden">Users — role, account status, contributions and last login</caption>
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">
                  User
                </th>
                <th role="columnheader" scope="col">
                  Admin
                </th>
                <th role="columnheader" scope="col">
                  Active
                </th>
                <th role="columnheader" scope="col" className="num">
                  Songs
                </th>
                <th role="columnheader" scope="col" className="num">
                  Shows
                </th>
                <th role="columnheader" scope="col" className="num">
                  Comments
                </th>
                <th role="columnheader" scope="col">
                  Joined
                </th>
                <th role="columnheader" scope="col">
                  Last login
                </th>
                <th role="columnheader" scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {visible.map((u) => {
                const self = me?.id === u.id;
                const busy = busyId === u.id;
                return (
                  <tr key={u.id} role="row" className={`${u.disabled ? 'is-disabled' : ''}${busy ? ' is-busy' : ''}`} data-testid="user-row" data-user-id={u.id}>
                    <td role="cell" className="c-user">
                      <div className="admin-user">
                        <UserAvatar name={u.displayName} size="md" />
                        <div className="admin-user-text">
                          <span className="admin-user-name">
                            <bdi>{u.displayName}</bdi>
                            {u.role === 'admin' && (
                              <span className="admin-crown" title="Admin" aria-label="(admin)">
                                👑
                              </span>
                            )}
                            {self && <span className="badge badge-outline">You</span>}
                          </span>
                          <a className="admin-user-email" href={`mailto:${u.email}`}>
                            {u.email}
                          </a>
                          <span className="admin-user-flags">
                            {u.disabled && <span className="badge badge-danger">Disabled</span>}
                            {u.mustChangePassword && (
                              <span className="badge badge-warning" title="Signed in with a temporary password — must choose a new one">
                                <KeyRound size={11} aria-hidden="true" /> Temp password
                              </span>
                            )}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td role="cell" className="c-role" data-label="Admin">
                      <Switch
                        checked={u.role === 'admin'}
                        disabled={busy}
                        onChange={(v) => void onRoleToggle(u, v)}
                        label={<span className="visually-hidden">Admin: {u.displayName}</span>}
                        testId="user-role-switch"
                      />
                    </td>
                    <td role="cell" className="c-active" data-label="Active">
                      <span title={self ? 'You can’t disable your own account' : undefined}>
                        <Switch
                          checked={!u.disabled}
                          disabled={busy || self}
                          onChange={(v) => void onActiveToggle(u, v)}
                          label={<span className="visually-hidden">Account active: {u.displayName}</span>}
                          testId="user-active-switch"
                        />
                      </span>
                    </td>
                    <td role="cell" className="num c-songs" data-label="Songs">
                      {u.songCount}
                    </td>
                    <td role="cell" className="num c-shows" data-label="Shows">
                      {u.showCount}
                    </td>
                    <td role="cell" className="num c-comments" data-label="Comments">
                      {u.commentCount}
                    </td>
                    <td role="cell" className="c-joined nowrap" data-label="Joined">
                      <time dateTime={u.createdAt}>{formatDate(u.createdAt)}</time>
                    </td>
                    <td role="cell" className="c-login nowrap" data-label="Last login">
                      {u.lastLoginAt ? (
                        <time dateTime={u.lastLoginAt} title={formatDate(u.lastLoginAt)}>
                          {relativeTime(u.lastLoginAt)}
                        </time>
                      ) : (
                        <span className="subtle">Never</span>
                      )}
                    </td>
                    <td role="cell" className="c-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => void onReset(u)}
                        disabled={busy || self}
                        title={self ? 'Change your own password in My stuff' : undefined}
                        data-testid="reset-password"
                      >
                        {busy ? <span className="spinner" aria-hidden="true" /> : <KeyRound size={15} aria-hidden="true" />}
                        Reset password
                        <span className="visually-hidden"> for {u.displayName}</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {dialog}
      <TempPasswordModal value={temp} onClose={() => setTemp(null)} />
    </div>
  );
}

interface TempPassword {
  user: AdminUser;
  password: string;
  /** ISO time the unused temporary password stops working (server ≥ this version sends it). */
  expiresAt: string | null;
}

/** "Wednesday, September 30 at 3:15 p.m." in the admin's own locale/time zone, or null. */
function formatExpiry(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function TempPasswordModal({ value, onClose }: { value: TempPassword | null; onClose: () => void }) {
  const expires = formatExpiry(value?.expiresAt ?? null);
  return (
    <Modal
      open={value !== null}
      onClose={onClose}
      closeOnBackdrop={false}
      title={value ? `New password for ${value.user.displayName}` : ''}
      testId="temp-password-modal"
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose} data-testid="temp-password-done">
          Done — I’ve saved it
        </button>
      }
    >
      {value && (
        <div className="admin-temp">
          <p className="admin-temp-warning">
            <span aria-hidden="true">⚠️ </span>
            <strong>This is the only time you’ll see it.</strong> Copy it now.
          </p>
          <div className="admin-temp-ticket">
            <span className="admin-temp-label">Temporary password</span>
            <code className="admin-temp-code" data-testid="temp-password">
              {value.password}
            </code>
            <CopyButton text={value.password} label="Copy password" testId="copy-temp-password" />
          </div>
          <ol className="admin-temp-steps">
            <li>
              Give it to <strong>{value.user.displayName}</strong> in person (or via their teacher).
            </li>
            <li>
              They log in with <strong>{value.user.email}</strong> and this password.
            </li>
            <li>They’ll be asked to choose a brand-new password straight away.</li>
          </ol>
          {expires && (
            <p className="small muted" data-testid="temp-password-expiry">
              If it isn’t used by <strong>{expires}</strong>, it stops working — just reset it again.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
