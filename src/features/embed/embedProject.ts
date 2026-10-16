import { AccountRequestError } from '../../client/api/accountApi';
import { validateProjectDocument, type ProjectDocument } from '../../domain/project/projectDocument';

export type PublicDesign = { project: ProjectDocument; revision: number };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Embeds never use an authenticated session or a private offline copy. */
export async function fetchPublicDesign(id: string, signal: AbortSignal): Promise<PublicDesign> {
  if (!UUID.test(id)) throw new AccountRequestError('Este diseño no está disponible.', 404);
  const response = await fetch('/api/rooms/' + encodeURIComponent(id) + '?public=1', { credentials: 'omit', cache: 'no-store', signal });
  if (!response.ok) throw new AccountRequestError(response.status === 404 || response.status === 403 ? 'Este diseño no está disponible.' : 'No se pudo cargar el diseño.', response.status);
  const data = await response.json();
  if (data.shared !== true || data.role !== 'public' || data.canEdit !== false || !Number.isSafeInteger(data.revision) || data.revision < 1) throw new Error('Este diseño no está disponible.');
  const project = validateProjectDocument(data.project);
  if (project.id !== id) throw new Error('Este diseño no está disponible.');
  return { project, revision: data.revision };
}
