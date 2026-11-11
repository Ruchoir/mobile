/**
 * The calls the screens were written against that no product's contract serves, with the shapes
 * they had. Organisation and account management (members, roles, groups, invitations, licences,
 * the journal, the second factor, the password) is Propolis's, reached through its pages; the rest
 * is not in any product yet. Each rejects with `ProductUnavailable` (`client.ts`), and the screens
 * that need one are hidden.
 */
import type { AdminUser, DropToken, EndedAccess, ImportFile, ImportJob, ImportPlan, ImportedPerson, InstanceSettings, InviteOutcome, LoginResult, Member, MfaState, PersonChoice, SearchHits, SessionUser, SignedIn, SpaceIdentity, UploadPart, UploadRequest, UploadedFile } from "./shared/model.ts";
import type { Invitee, LinkableChannel } from "./shared/calendarModel.ts";
import type { AccountPrefsDoc } from "./shared/accountPrefs.ts";
import type { AccessKind, AccessLevel, AccessTargetRef, AccessView, AdminLicence, AuditPage, AuditQuery, BlankKind, CreatedInvitation, Group, Invitation, InvitationPreview, LicenceView, MessageAttachment, NotifyLevel, Preview, Profile, Role, SpaceFile, WhyView, Workspace } from "./shared/types.ts";

export const UNAVAILABLE = [
  "adoptBrowserTimezone", "syncAccountLocale", "login", "logoutEverywhere", "createNativeCode",
  "exchangeNativeCode", "createWebHandoff", "redeemWebHandoff", "getMfaState", "enrollTotp", "confirmTotp",
  "disableTotp", "generateRecoveryCodes", "removePasskey", "changePassword", "register",
  "requestEmailVerification", "confirmEmailVerification", "confirmEmailVerificationCode",
  "requestPasswordReset", "confirmPasswordReset", "resetPasswordWithRecoveryCode", "searchAccounts",
  "issuePasswordResetLink", "getInstanceSettings", "updateInstanceSettings", "verifyTotp",
  "verifyRecoveryCode", "saveSpaceNotify", "createSpace", "renameSpace", "setMemberRole", "leaveSpace",
  "removeMember", "createRole", "updateRole", "deleteRole", "orderRoles", "setMemberRoles", "createGroup",
  "updateGroup", "deleteGroup", "addGroupMembers", "removeGroupMember", "setGroupRoles", "setGroupManagers",
  "setGuestExpiry", "reactivateGuest", "listEndedAccess", "getAccess", "setAccessLevel", "setAccessRule",
  "removeAccessEntry", "explainAccess", "startPreview", "quitPreview", "getAudit", "getLicence",
  "getAdminLicences", "putLicence", "checkLicence", "deleteLicence", "deleteSpace", "resolveSpaceSlug",
  "createInvitation", "inviteToChannel", "getInvitations", "revokeInvitation", "previewInvitation",
  "acceptInvitation", "startAttachmentUpload", "uploadAttachment", "setMyAvatar", "clearMyAvatar",
  "setSpaceIcon", "clearSpaceIcon", "getUserProfile", "updateMyProfile", "getAccountPreferences",
  "patchAccountPreferences", "savePushSubscription", "sendTestPush", "forgetPushSubscription", "search",
  "getConversationFiles", "sendFile", "createBlankDocument", "planImport", "startImport", "inviteImported",
  "listImports", "getImport", "listImportedPeople", "cancelImport", "issueDropToken", "listImportFiles",
  "shareCandidates", "searchInvitees", "listLinkableChannels", "eventAttachmentFolder",
] as const;

export type UnavailableCalls = {
  adoptBrowserTimezone: (current?: string) => Promise<string | undefined>;
  syncAccountLocale: (current: string | undefined, inForce: string) => Promise<void>;
  login: (email: string, password: string) => Promise<LoginResult>;
  logoutEverywhere: () => Promise<void>;
  createNativeCode: (challenge: string) => Promise<string>;
  exchangeNativeCode: (code: string, verifier: string) => Promise<SignedIn>;
  createWebHandoff: () => Promise<string>;
  redeemWebHandoff: (code: string) => Promise<SessionUser>;
  getMfaState: (signal?: AbortSignal) => Promise<MfaState>;
  enrollTotp: () => Promise<{ otpauthUrl: string; qrSvg: string }>;
  confirmTotp: (code: string) => Promise<void>;
  disableTotp: (password: string) => Promise<void>;
  generateRecoveryCodes: () => Promise<string[]>;
  removePasskey: (credentialId: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  register: (email: string, displayName: string, password: string, invitationToken?: string,) => Promise<{ user: SessionUser; active: boolean }>;
  requestEmailVerification: (email: string) => Promise<void>;
  confirmEmailVerification: (token: string) => Promise<void>;
  confirmEmailVerificationCode: (email: string, code: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  confirmPasswordReset: (token: string, password: string) => Promise<void>;
  resetPasswordWithRecoveryCode: (email: string, code: string, password: string) => Promise<void>;
  searchAccounts: (query: string, signal?: AbortSignal) => Promise<AdminUser[]>;
  issuePasswordResetLink: (userId: string) => Promise<{ url: string; expiresInSecs: number }>;
  getInstanceSettings: (signal?: AbortSignal) => Promise<InstanceSettings>;
  updateInstanceSettings: (patch: Partial<InstanceSettings>) => Promise<InstanceSettings>;
  verifyTotp: (mfaToken: string, code: string) => Promise<SignedIn>;
  verifyRecoveryCode: (mfaToken: string, code: string) => Promise<SignedIn>;
  saveSpaceNotify: (spaceId: string, level: NotifyLevel) => Promise<void>;
  createSpace: (name: string) => Promise<Workspace>;
  renameSpace: (spaceId: string, name: string) => Promise<SpaceIdentity>;
  setMemberRole: (spaceId: string, userId: string, role: string, options: { expiresAt?: string | null },) => Promise<{ userId: string; role: string }[]>;
  leaveSpace: (spaceId: string) => Promise<void>;
  removeMember: (spaceId: string, userId: string) => Promise<void>;
  createRole: (spaceId: string, role: { name: string; colour?: string; copyFrom?: string }) => Promise<Role>;
  updateRole: (spaceId: string, roleId: string, change: { name?: string; colour?: string; permissions?: string[] }) => Promise<Role>;
  deleteRole: (spaceId: string, roleId: string) => Promise<void>;
  orderRoles: (spaceId: string, roleIds: string[]) => Promise<Role[]>;
  setMemberRoles: (spaceId: string, userId: string, roleIds: string[]) => Promise<string[]>;
  createGroup: (spaceId: string, group: { name: string; description?: string }) => Promise<Group>;
  updateGroup: (spaceId: string, groupId: string, patch: { name?: string; description?: string }) => Promise<Group>;
  deleteGroup: (spaceId: string, groupId: string) => Promise<void>;
  addGroupMembers: (spaceId: string, groupId: string, userIds: string[]) => Promise<Group>;
  removeGroupMember: (spaceId: string, groupId: string, userId: string) => Promise<void>;
  setGroupRoles: (spaceId: string, groupId: string, roleIds: string[]) => Promise<Group>;
  setGroupManagers: (spaceId: string, groupId: string, userIds: string[]) => Promise<Group>;
  setGuestExpiry: (spaceId: string, userId: string, expiresAt: string | null) => Promise<Member>;
  reactivateGuest: (spaceId: string, userId: string, expiresAt: string | null) => Promise<Member>;
  listEndedAccess: (spaceId: string, signal?: AbortSignal) => Promise<EndedAccess[]>;
  getAccess: (spaceId: string, kind: AccessKind, resourceId: string) => Promise<AccessView>;
  setAccessLevel: (spaceId: string, kind: AccessKind, resourceId: string, target: AccessTargetRef, level: Exclude<AccessLevel, "custom">,) => Promise<AccessView>;
  setAccessRule: (spaceId: string, kind: AccessKind, resourceId: string, target: AccessTargetRef, rule: { allow: string[]; deny: string[] },) => Promise<AccessView>;
  removeAccessEntry: (spaceId: string, kind: AccessKind, resourceId: string, ruleId: string) => Promise<void>;
  explainAccess: (spaceId: string, kind: AccessKind, resourceId: string, userId?: string) => Promise<WhyView>;
  startPreview: (spaceId: string, roleId: string) => Promise<Preview>;
  quitPreview: (spaceId: string) => Promise<void>;
  getAudit: (spaceId: string, query: AuditQuery) => Promise<AuditPage>;
  getLicence: (spaceId: string) => Promise<LicenceView | null>;
  getAdminLicences: (signal?: AbortSignal) => Promise<AdminLicence[]>;
  putLicence: (spaceId: string, licence: string) => Promise<LicenceView>;
  checkLicence: (spaceId: string) => Promise<LicenceView>;
  deleteLicence: (spaceId: string) => Promise<void>;
  deleteSpace: (spaceId: string) => Promise<void>;
  resolveSpaceSlug: (slug: string) => Promise<{ id: string; slug: string } | null>;
  createInvitation: (spaceId: string, options: { email?: string; role?: string; expiresInHours?: number; maxUses?: number; guestExpiresAt?: string | null },) => Promise<CreatedInvitation>;
  inviteToChannel: (channelId: string, email: string) => Promise<CreatedInvitation>;
  getInvitations: (spaceId: string, signal?: AbortSignal) => Promise<Invitation[]>;
  revokeInvitation: (spaceId: string, invitationId: string) => Promise<void>;
  previewInvitation: (token: string, signal?: AbortSignal) => Promise<InvitationPreview>;
  acceptInvitation: (token: string) => Promise<Workspace>;
  startAttachmentUpload: (conversationId: string, part: UploadPart, onProgress?: (sent: number) => void) => UploadRequest<MessageAttachment>;
  uploadAttachment: (conversationId: string, part: UploadPart) => Promise<MessageAttachment>;
  setMyAvatar: (file: UploadPart) => Promise<string>;
  clearMyAvatar: () => Promise<void>;
  setSpaceIcon: (spaceId: string, file: UploadPart) => Promise<string>;
  clearSpaceIcon: (spaceId: string) => Promise<void>;
  getUserProfile: (userId: string, signal?: AbortSignal) => Promise<Profile>;
  updateMyProfile: (patch: { displayName?: string; title?: string; pronouns?: string; bio?: string; /** IANA name, or "" to clear it. */ timezone?: string; /** Interface language, so what the server writes arrives in the language being read. */ locale?: string; }) => Promise<Profile>;
  getAccountPreferences: (signal?: AbortSignal) => Promise<AccountPrefsDoc | null>;
  patchAccountPreferences: (patch: AccountPrefsDoc) => Promise<AccountPrefsDoc>;
  savePushSubscription: (subscription: PushSubscriptionJSON) => Promise<void>;
  sendTestPush: () => Promise<{ subscriptions: number; delivered: number }>;
  forgetPushSubscription: (endpoint: string) => Promise<void>;
  search: (spaceId: string, query: string, signal?: AbortSignal) => Promise<SearchHits>;
  getConversationFiles: (conversationId: string, signal?: AbortSignal) => Promise<SpaceFile[]>;
  sendFile: (target: { spaceId: string; folderId?: string; name: string; replaceFileId?: string }, file: File, onProgress: (loaded: number) => void) => UploadRequest<UploadedFile>;
  createBlankDocument: (spaceId: string, kind: BlankKind, name: string, folderId?: string,) => Promise<SpaceFile>;
  planImport: (file: string, passphrase?: string) => Promise<ImportPlan>;
  startImport: (file: string, passphrase?: string, replaceInstanceAddress?: string, people?: PersonChoice[]) => Promise<ImportJob>;
  inviteImported: (id: string, sourceIds: string[]) => Promise<InviteOutcome>;
  listImports: (signal?: AbortSignal) => Promise<ImportJob[]>;
  getImport: (id: string, signal?: AbortSignal) => Promise<ImportJob>;
  listImportedPeople: (id: string, signal?: AbortSignal) => Promise<ImportedPerson[]>;
  cancelImport: (id: string) => Promise<ImportJob>;
  issueDropToken: () => Promise<DropToken>;
  listImportFiles: (signal?: AbortSignal) => Promise<ImportFile[]>;
  shareCandidates: (calendarId: string, query: string, signal?: AbortSignal) => Promise<{ userId: string; name: string }[]>;
  searchInvitees: (calendarId: string, query: string, signal?: AbortSignal, channel?: string) => Promise<Invitee[]>;
  listLinkableChannels: (calendarId: string, signal?: AbortSignal) => Promise<LinkableChannel[]>;
  eventAttachmentFolder: (calendarId: string, channelId?: string, signal?: AbortSignal) => Promise<{ spaceId: string; folderId: string }>;
};
