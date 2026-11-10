/**
 * The drive's API (`contract/openapi-v1.json` of Ruchoir/drive): folders, files, uploads, versions,
 * trash, favourites, public links and the office editor.
 *
 * Each call is the route of the product, made with its own access token (`../http`).
 */
import type { Transport } from "../shared/http.ts";
import { toEventCard } from "../shared/calendarModel.ts";
import { ApiError, apiErrorMessage } from "../shared/http.ts";
import { multipartBody } from "../shared/multipart.ts";
import { type InlineImage, type MessageAttachment, type MessageKind, type OfficeSession, type SpaceFile } from "../shared/types.ts";
import { appendPart, attachmentIcon, iconForSystemEvent, isSystemEvent, toImportSource, toPublicLink, toReaction, toSpaceFileKind } from "../shared/model.ts";
import type { ApiMessage, AttachmentDto, DuplicateAnswer, FileDto, FileLink, FileVersion, FilesView, FolderListing, FolderListingDto, LinkDto, MessageDto, OfficeSessionDto, PublicLink, PublicLinkDto, TrashEntry, TrashEntryDto, UploadDuplicate, UploadPart, UploadRequest, UploadedFile, VersionDto, ViewEntry, ViewEntryDto } from "../shared/model.ts";

export function createDriveApi(transport: Transport) {
  const { apiGet, apiPost, apiPut, apiPatch, apiDelete, apiBase, apiOrigin, authInit, clientOptions } = transport;

  /** The interface language, as the host app reports it (see `configureClient`). */
  const currentLocale = () => clientOptions().locale();


  /**
   * Hand a multipart `form` to `begin` (which opens `xhr` and sends the payload) and return the
   * request's handle.
   *
   * Without `inMemoryUploads` the form goes as it is. With it, the form is flattened first (see
   * `multipart.ts`), which takes a moment during which `xhr` has not been opened. An abort in that
   * window cannot go through `xhr.abort()`: the platform fires no `abort` event for a request that
   * was never opened, so `done` would hang. It is rejected here instead, with the same `AbortError`,
   * and the send is skipped. A flattening that fails, or a `begin` that throws, rejects `done` with a
   * network {@link ApiError} (status 0, as a dropped connection): an `AbortError` would be taken for a
   * person's own cancel and dropped silently.
   */
  function sendForm<T>(
    xhr: XMLHttpRequest,
    form: FormData,
    begin: (payload: XMLHttpRequestBodyInit, contentType?: string) => void,
    done: Promise<T>,
    fail: (reason: unknown) => void,
  ): UploadRequest<T> {
    const handle = (abort: () => void) => ({ done, abort });
    if (!clientOptions().inMemoryUploads) {
      begin(form);
      return handle(() => xhr.abort());
    }
    let state: "preparing" | "sent" | "aborted" = "preparing";
    multipartBody(form).then(
      ({ body, contentType }) => {
        if (state !== "preparing") return;
        try {
          begin(body, contentType);
          state = "sent";
        } catch {
          state = "aborted";
          fail(new ApiError(0, "network", null));
        }
      },
      () => {
        if (state === "preparing") fail(new ApiError(0, "network", null));
        state = "aborted";
      },
    );
    return handle(() => {
      if (state === "preparing") {
        state = "aborted";
        fail(Object.assign(new Error("aborted"), { name: "AbortError" }));
      } else if (state === "sent") {
        xhr.abort();
      }
    });
  }

  /**
   * A multipart `POST` (or `PUT`) over `XMLHttpRequest`, for its upload progress: what
   * {@link startAttachmentUpload}, {@link startFileUpload} and the images share. `map` reads the created
   * resource from the answer.
   */
  function xhrUpload<T>(
    path: string,
    form: FormData,
    map: (body: unknown) => T,
    onProgress?: (sent: number) => void,
    method: "POST" | "PUT" = "POST",
  ): UploadRequest<T> {
    const xhr = new XMLHttpRequest();
    let fail!: (reason: unknown) => void;
    const done = new Promise<T>((resolve, reject) => {
      fail = reject;
      xhr.onload = () => {
        let body: unknown = null;
        try {
          body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch {
          body = xhr.responseText;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(map(body));
          return;
        }
        if (xhr.status === 401) clientOptions().onUnauthorized();
        reject(new ApiError(xhr.status, apiErrorMessage(body, xhr.status), body));
      };
      xhr.onerror = () => reject(new ApiError(0, "network", null));
      xhr.onabort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    });
    const auth = authInit();
    const begin = (payload: XMLHttpRequestBodyInit, contentType?: string) => {
      xhr.open(method, `${apiBase()}${path}`);
      // Same-origin on the web, where the cookie goes anyway; an app presents its bearer and no cookie.
      xhr.withCredentials = false;
      for (const [name, value] of Object.entries(auth.headers)) xhr.setRequestHeader(name, value);
      if (contentType) xhr.setRequestHeader("Content-Type", contentType);
      if (onProgress) xhr.upload.onprogress = (event) => onProgress(event.loaded);
      xhr.send(payload);
    };
    return sendForm(xhr, form, begin, done, fail);
  }


  // --- Mapping helpers ---


  /**
   * Keep attachment order while retaining the first-item aliases used by compact legacy views.
   */
  function splitAttachments(attachments: AttachmentDto[]): {
    attachment?: MessageAttachment;
    attachments?: MessageAttachment[];
    image?: InlineImage;
    images?: InlineImage[];
  } {
    const attachmentsOut: MessageAttachment[] = [];
    const imagesOut: InlineImage[] = [];
    for (const a of attachments) {
      // A file removed from the space keeps its place in the message, without a link: every URL to
      // its bytes answers 404, and an image whose source 404s is a broken frame rather than an
      // absence. What the message carried is still worth saying; what it carried is simply gone.
      if (a.deleted) {
        attachmentsOut.push({
          fileId: a.file_id,
          name: a.name,
          sizeBytes: a.size_bytes,
          kind: attachmentIcon(a.kind),
          deleted: true,
        });
        continue;
      }
      if (a.kind === "image" && a.image_width && a.image_height) {
        imagesOut.push({
          fileId: a.file_id,
          alt: a.alt_text ?? a.name,
          name: a.name,
          width: a.image_width,
          height: a.image_height,
          // Served by the API, never by the object store: the browser never talks to it directly.
          // `preview` is the original bytes, so opening it in a tab shows full quality.
          src: `${apiBase()}/files/${a.file_id}/preview`,
          downloadUrl: `${apiBase()}/files/${a.file_id}/download`,
        });
      } else {
        attachmentsOut.push({
          fileId: a.file_id,
          name: a.name,
          sizeBytes: a.size_bytes,
          kind: attachmentIcon(a.kind),
          url: `${apiBase()}/files/${a.file_id}/download`,
          previewUrl: `${apiBase()}/files/${a.file_id}/preview`,
        });
      }
    }
    return {
      attachment: attachmentsOut[0],
      attachments: attachmentsOut.length ? attachmentsOut : undefined,
      image: imagesOut[0],
      images: imagesOut.length ? imagesOut : undefined,
    };
  }

  // --- Search ---


  // --- Files ---

  function toSpaceFile(dto: FileDto): SpaceFile {
    return {
      id: dto.id,
      name: dto.name,
      kind: toSpaceFileKind(dto.kind, dto.is_folder),
      sizeBytes: dto.is_folder ? 0 : dto.size_bytes,
      by: dto.owner_name ?? "",
      updatedAt: dto.updated_at,
      // The connector a migrated file came from; native files (and unknown connectors) read as Ruchoir.
      source: toImportSource(dto.imported_source) ?? "Ruchoir",
      version: dto.version_no != null ? `v${dto.version_no}` : "",
      imported: dto.imported,
      // Generated and stored server-side at upload; served by the API, never by the object store.
      thumbnailUrl: dto.has_thumbnail ? `${apiBase()}/files/${dto.id}/thumbnail` : undefined,
      parentFolderId: dto.parent_folder_id,
      editors: dto.editors ?? [],
      ownerId: dto.owner_id,
      modifiedBy: dto.modified_by_name,
      childCount: dto.child_count,
      createdAt: dto.created_at,
      mimeType: dto.mime_type,
      versionNo: dto.version_no,
      starred: dto.starred === true,
      myPermissions: dto.my_permissions,
    };
  }

  /** `GET /organisations/{id}/files`: the entries of a folder (or the space root when `folderId` is absent). */
  async function getFolder(
    spaceId: string,
    folderId?: string,
    signal?: AbortSignal,
  ): Promise<FolderListing> {
    const query = folderId ? `?folder=${folderId}` : "";
    const listing = await apiGet<FolderListingDto>(`/organisations/${spaceId}/files${query}`, signal);
    return {
      folderId: listing.folder_id,
      breadcrumb: listing.breadcrumb,
      entries: listing.entries.map(toSpaceFile),
    };
  }

  /** `POST /organisations/{id}/folders`: create a folder (at the root, or inside `parentId`). */
  async function createFolder(spaceId: string, name: string, parentId?: string): Promise<SpaceFile> {
    const dto = await apiPost<FileDto>(`/organisations/${spaceId}/folders`, {
      name,
      parent_folder_id: parentId,
    });
    return toSpaceFile(dto);
  }

  /** The duplicate an upload was refused for, or null for any other failure. */
  function uploadDuplicate(err: unknown): UploadDuplicate | null {
    if (!(err instanceof ApiError) || err.status !== 409) return null;
    const body = err.body as { error?: string; reason?: UploadDuplicate["reason"]; existing?: FileDto; path?: string[] } | null;
    if (body?.error !== "duplicate" || !body.reason || !body.existing) return null;
    return { reason: body.reason, existing: toSpaceFile(body.existing), path: body.path ?? [] };
  }

  const toUploaded = (body: unknown): UploadedFile => {
    const dto = body as FileDto & { merged?: string };
    return { ...toSpaceFile(dto), ...(dto.merged === "version" ? { merged: true } : {}) };
  };

  /**
   * The `fetch` options carrying `form`: the credentials and bearer, and the body, which is the
   * `FormData` itself (the platform then sets the boundary) or, under `inMemoryUploads`, its bytes with
   * the `Content-Type` that names the boundary (see `multipart.ts`).
   */
  async function multipartInit(form: FormData): Promise<RequestInit> {
    const auth = authInit();
    if (!clientOptions().inMemoryUploads) return { ...auth, body: form };
    const { body, contentType } = await multipartBody(form);
    return { ...auth, headers: { ...auth.headers, "Content-Type": contentType }, body };
  }

  /** `POST /organisations/{id}/files`: upload a file (multipart) into the root or a folder. */
  async function uploadFile(spaceId: string, file: File, parentId?: string, answer?: DuplicateAnswer): Promise<UploadedFile> {
    const form = new FormData();
    form.append("file", file);
    // `folder_id`, not `parent_folder_id`: the JSON endpoints use the latter, the multipart
    // upload uses the former, and sending the wrong one put every file in a folder at the root.
    if (parentId) form.append("folder_id", parentId);
    if (answer) form.append("on_conflict", answer);
    // Multipart: let the browser set the boundary, so this call does not go through the JSON client.
    const res = await fetch(`${apiBase()}/organisations/${spaceId}/files`, {
      method: "POST",
      ...(await multipartInit(form)),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => null);
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        // Not JSON: kept as text.
      }
      throw new ApiError(res.status, `HTTP ${res.status}`, body);
    }
    return toUploaded(await res.json());
  }

  /**
   * `POST /organisations/{id}/files`, as {@link uploadFile}, for a file of the phone (`UploadPart`) and with its
   * progress: a photo sent to a space's files over a weak network has to show how far it is. Rejects as
   * {@link startAttachmentUpload} does (413: larger than the instance allows).
   */
  function startFileUpload(
    spaceId: string,
    part: UploadPart,
    folderId?: string,
    onProgress?: (sent: number) => void,
    answer?: DuplicateAnswer,
  ): UploadRequest<UploadedFile> {
    const form = new FormData();
    appendPart(form, part);
    // `folder_id`, as `uploadFile` explains.
    if (folderId) form.append("folder_id", folderId);
    if (answer) form.append("on_conflict", answer);
    return xhrUpload(`/organisations/${spaceId}/files`, form, toUploaded, onProgress);
  }

  /**
   * `POST /files/{id}/versions`: replace a file's contents, keeping its name, place and history.
   *
   * The version becomes the one served by download and preview, and the previous bytes stay stored.
   * Reading the history back needs a route that does not exist yet, so what this offers today is
   * "here is a newer copy of the same document" rather than a version browser.
   */
  async function uploadFileVersion(fileId: string, file: File): Promise<SpaceFile> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${apiBase()}/files/${fileId}/versions`, {
      method: "POST",
      ...(await multipartInit(form)),
    });
    if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`, await res.text().catch(() => null));
    return toSpaceFile((await res.json()) as FileDto);
  }

  /**
   * `POST /files/{id}/versions`, as {@link uploadFileVersion}, for a file of the phone (`UploadPart`) and
   * with its progress, as {@link startFileUpload} does.
   */
  function startFileVersionUpload(fileId: string, part: UploadPart, onProgress?: (sent: number) => void): UploadRequest<SpaceFile> {
    const form = new FormData();
    form.append("file", part as Blob);
    return xhrUpload(`/files/${fileId}/versions`, form, (body) => toSpaceFile(body as FileDto), onProgress);
  }

  // --- Trash and versions ---

  /** `GET /organisations/{id}/trash`: the space's trash, latest removal first. */
  async function getTrash(spaceId: string, signal?: AbortSignal): Promise<TrashEntry[]> {
    const rows = await apiGet<TrashEntryDto[]>(`/organisations/${spaceId}/trash`, signal);
    return rows.map((r) => ({
      file: toSpaceFile(r.file),
      deletedAt: r.deleted_at,
      deletedBy: r.deleted_by_name,
      originalFolderId: r.original_folder_id,
      originalFolderName: r.original_folder_name,
      originalFolderPresent: r.original_folder_present,
      canManage: r.can_manage,
    }));
  }

  /** `POST /files/{id}/restore`: bring a trash entry back (at the root when its folder is gone). */
  async function restoreFile(fileId: string): Promise<{ file: SpaceFile; restoredToRoot: boolean }> {
    const dto = await apiPost<{ file: FileDto; restored_to_root: boolean }>(`/files/${fileId}/restore`, {});
    return { file: toSpaceFile(dto.file), restoredToRoot: dto.restored_to_root };
  }

  /** `DELETE /files/{id}/trash`: erase a trash entry for good. */
  async function eraseFile(fileId: string): Promise<void> {
    await apiDelete<void>(`/files/${fileId}/trash`);
  }

  /** `DELETE /organisations/{id}/trash`: erase every trash entry this person may manage; how many. */
  async function emptyTrash(spaceId: string): Promise<number> {
    const dto = await apiDelete<{ erased: number }>(`/organisations/${spaceId}/trash`);
    return dto?.erased ?? 0;
  }

  /** `GET /files/{id}/versions`: a file's versions, newest first. */
  async function getVersions(fileId: string, signal?: AbortSignal): Promise<FileVersion[]> {
    const rows = await apiGet<VersionDto[]>(`/files/${fileId}/versions`, signal);
    return rows.map((v) => ({
      id: v.id,
      number: v.version_no,
      sizeBytes: v.size_bytes,
      createdAt: v.created_at,
      createdBy: v.created_by_name,
      current: v.current,
    }));
  }

  /** The same-origin URL that downloads one version's bytes. */
  function versionDownloadUrl(fileId: string, versionId: string): string {
    return `${apiBase()}/files/${fileId}/versions/${versionId}/download`;
  }

  /** `POST /files/{id}/versions/{vid}/restore`: an old version comes back as the newest. */
  async function restoreVersion(fileId: string, versionId: string): Promise<SpaceFile> {
    return toSpaceFile(await apiPost<FileDto>(`/files/${fileId}/versions/${versionId}/restore`, {}));
  }

  // --- Views beyond a folder ---

  function toViewEntry(dto: ViewEntryDto): ViewEntry {
    return {
      file: toSpaceFile(dto.file),
      path: dto.path ?? [],
      sharedBy: dto.shared_by_name,
      sharedIn: dto.shared_in_kind ? { kind: dto.shared_in_kind, name: dto.shared_in_name } : undefined,
      sharedAt: dto.shared_at,
    };
  }

  /** `GET /organisations/{id}/files/{recent|starred|shared}`. */
  async function getFilesView(spaceId: string, view: FilesView, signal?: AbortSignal): Promise<ViewEntry[]> {
    return (await apiGet<ViewEntryDto[]>(`/organisations/${spaceId}/files/${view}`, signal)).map(toViewEntry);
  }

  /** `GET /organisations/{id}/files/search?q=`: the whole space's files and folders whose name contains `q`. */
  async function searchFiles(spaceId: string, q: string, signal?: AbortSignal): Promise<ViewEntry[]> {
    return (await apiGet<ViewEntryDto[]>(`/organisations/${spaceId}/files/search?q=${encodeURIComponent(q)}`, signal)).map(toViewEntry);
  }

  /** `PUT|DELETE /files/{id}/star`: keep among one's favourites, or not. */
  async function setStarred(fileId: string, starred: boolean): Promise<void> {
    if (starred) await apiPut<void>(`/files/${fileId}/star`, {});
    else await apiDelete<void>(`/files/${fileId}/star`);
  }

  // --- Public links ---

  /** The public address of a link, on this instance. */
  function publicLinkUrl(token: string): string {
    return `${apiOrigin()}/s/?t=${encodeURIComponent(token)}`;
  }

  function toLink(dto: LinkDto): FileLink {
    return {
      id: dto.id,
      token: dto.token,
      url: publicLinkUrl(dto.token),
      createdAt: dto.created_at,
      createdBy: dto.created_by_name,
      expiresAt: dto.expires_at,
      expired: dto.expired,
      hasPassword: dto.has_password,
      downloads: dto.download_count,
    };
  }

  /** `GET /files/{id}/links`: the file's live public links. */
  async function listLinks(fileId: string, signal?: AbortSignal): Promise<FileLink[]> {
    return (await apiGet<LinkDto[]>(`/files/${fileId}/links`, signal)).map(toLink);
  }

  /** `POST /files/{id}/links`: a new public link, ending at `expiresAt` and asking for `password` when given. */
  async function createLink(fileId: string, opts: { expiresAt?: string; password?: string }): Promise<FileLink> {
    return toLink(await apiPost<LinkDto>(`/files/${fileId}/links`, { expires_at: opts.expiresAt, password: opts.password }));
  }

  /** `DELETE /files/{id}/links/{linkId}`: revoke a public link. */
  async function revokeLink(fileId: string, linkId: string): Promise<void> {
    await apiDelete<void>(`/files/${fileId}/links/${linkId}`);
  }

  /** `GET /public/links/{token}`: no session needed. A `404` means the link is no longer valid. */
  async function getPublicLink(token: string, grant?: string): Promise<PublicLink> {
    const query = grant ? `?grant=${encodeURIComponent(grant)}` : "";
    return toPublicLink(await apiGet<PublicLinkDto>(`/public/links/${encodeURIComponent(token)}${query}`));
  }

  /** `POST /public/links/{token}/unlock`: the password; the grant it earns, and the file. A `403` is the wrong password. */
  async function unlockLink(token: string, password: string): Promise<{ grant: string; link: PublicLink }> {
    const dto = await apiPost<{ grant: string; link: PublicLinkDto }>(`/public/links/${encodeURIComponent(token)}/unlock`, { password });
    return { grant: dto.grant, link: toPublicLink(dto.link) };
  }

  /** The address that downloads a shared file (with the grant a password earned, if any). */
  function publicDownloadUrl(token: string, grant?: string): string {
    return `${apiBase()}/public/links/${encodeURIComponent(token)}/download${grant ? `?grant=${encodeURIComponent(grant)}` : ""}`;
  }

  /** The address of a shared file's bytes, inline (an image, a PDF, a video, a sound, a text). */
  function publicPreviewUrl(token: string, grant?: string): string {
    return `${apiBase()}/public/links/${encodeURIComponent(token)}/preview${grant ? `?grant=${encodeURIComponent(grant)}` : ""}`;
  }

  /** The address of a shared office document as a PDF. */
  function publicDocumentUrl(token: string, grant?: string): string {
    return `${apiBase()}/public/links/${encodeURIComponent(token)}/document${grant ? `?grant=${encodeURIComponent(grant)}` : ""}`;
  }

  /** The address of a shared office document's first page, as a picture. */
  function publicPageUrl(token: string, grant?: string): string {
    return `${apiBase()}/public/links/${encodeURIComponent(token)}/page${grant ? `?grant=${encodeURIComponent(grant)}` : ""}`;
  }

  /** The address of a shared image's thumbnail. */
  function publicThumbnailUrl(token: string, grant?: string): string {
    return `${apiBase()}/public/links/${encodeURIComponent(token)}/thumbnail${grant ? `?grant=${encodeURIComponent(grant)}` : ""}`;
  }


  /**
   * `PATCH /files/{id}`: rename an entry, or move it into another folder.
   *
   * `parentFolderId` of `null` means the space's root, which the API takes as an explicit flag rather
   * than an absent field: leaving it out means "do not move", and the two have to be told apart.
   * Refusals are the server's to make (a folder cannot be moved into itself or into its own
   * descendant), so nothing is checked twice here.
   */
  async function updateFile(
    fileId: string,
    patch: { name?: string; parentFolderId?: string | null },
  ): Promise<SpaceFile> {
    const dto = await apiPatch<FileDto>(`/files/${fileId}`, {
      name: patch.name,
      parent_folder_id: patch.parentFolderId ?? undefined,
      move_to_root: patch.parentFolderId === null ? true : undefined,
    });
    return toSpaceFile(dto);
  }

  /**
   * `DELETE /files/{id}`: remove a file, or a folder and everything under it.
   *
   * The API has always answered this; nothing in the interface ever called it, so a file could be
   * put in a space and never taken out again. The removal is soft server-side, which is why it comes
   * back as a plain success and the caller simply reloads the folder.
   *
   * Allowed for whoever owns the file and for a space administrator, so an ordinary member can undo
   * their own upload. A 403 means neither, and is worth telling the user apart from a failure.
   */
  async function deleteFile(fileId: string): Promise<void> {
    await apiDelete<void>(`/files/${fileId}`);
  }

  /** The same-origin URL that streams a file's bytes (the API proxies the object store). */
  function fileDownloadUrl(fileId: string): string {
    return `${apiBase()}/files/${fileId}/download`;
  }

  /**
   * The same-origin URL of an office document converted to PDF. The version stamp is part of the
   * address so the browser's private copy is never taken for a newer version's.
   */
  function fileDocumentUrl(fileId: string, stamp: string): string {
    return `${apiBase()}/files/${fileId}/document?v=${encodeURIComponent(stamp)}`;
  }

  /** The same-origin URL for a file's inline preview bytes. */
  function filePreviewUrl(fileId: string): string {
    return `${apiBase()}/files/${fileId}/preview`;
  }

  // --- Live office editing ---

  /**
   * `POST /files/{id}/office`: open a file in the office editor.
   *
   * The API decides the mode from the member's rights and the format: `edit`, `view`, or `convert`
   * when asked to turn a legacy format into an editable copy.
   */
  async function openOfficeSession(
    fileId: string,
    opts: { theme: "light" | "dark"; accent?: string; style?: string; mode?: "convert"; mobile?: boolean; embedOrigin?: string },
  ): Promise<OfficeSession> {
    const dto = await apiPost<OfficeSessionDto>(`/files/${fileId}/office`, {
      locale: currentLocale(),
      theme: opts.theme,
      accent: opts.accent,
      // A simplified style: an instance that does not know the field opens Ruchoir's theme.
      style: opts.style,
      mode: opts.mode,
      mobile: opts.mobile,
      // Only the desktop app has one (`office_desktop_embed`): where the editor posts its messages.
      ...(opts.embedOrigin ? { embed_origin: opts.embedOrigin } : {}),
    });
    return {
      file: toSpaceFile(dto.file),
      spaceId: dto.file.space_id,
      url: dto.url,
      accessToken: dto.access_token,
      accessTokenTtl: dto.access_token_ttl,
      mode: dto.mode,
      config: dto.config,
      memberName: dto.member_name,
    };
  }

  /** `POST /files/{id}/office/heartbeat`: this tab is still editing the file. */
  async function officeHeartbeat(fileId: string, tab: string): Promise<void> {
    await apiPost<void>(`/files/${fileId}/office/heartbeat?tab=${encodeURIComponent(tab)}`);
  }

  /**
   * `DELETE /files/{id}/office/heartbeat`: this page stopped editing.
   *
   * `keepalive`, because it is sent as the page goes away (a closed tab) and must outlive it.
   */
  function endOfficeHeartbeat(fileId: string, tab: string): Promise<void> {
    return fetch(`${apiBase()}/files/${fileId}/office/heartbeat?tab=${encodeURIComponent(tab)}`, {
      method: "DELETE",
      ...authInit(),
      keepalive: true,
    }).then(
      () => undefined,
      () => undefined,
    );
  }

  /**
   * `GET /files/{id}/office/converted`: the copy this member's conversion of the file produced, or
   * `null` while the engine has not written it yet.
   */
  async function getConvertedCopy(fileId: string): Promise<SpaceFile | null> {
    const dto = await apiGet<FileDto | undefined>(`/files/${fileId}/office/converted`);
    return dto ? toSpaceFile(dto) : null;
  }

  return {
    createFolder, startFileUpload, startFileVersionUpload, getTrash, restoreFile, eraseFile, emptyTrash, getVersions, restoreVersion, searchFiles, setStarred, listLinks, createLink, revokeLink, getPublicLink, unlockLink, updateFile, deleteFile, openOfficeSession, officeHeartbeat, endOfficeHeartbeat, getConvertedCopy, getFolder, getFilesView, uploadDuplicate, uploadFile, uploadFileVersion, versionDownloadUrl, publicLinkUrl, publicDownloadUrl, publicPreviewUrl, publicDocumentUrl, publicPageUrl, publicThumbnailUrl, fileDownloadUrl, fileDocumentUrl, filePreviewUrl,
  };
}

export type DriveApi = ReturnType<typeof createDriveApi>;
