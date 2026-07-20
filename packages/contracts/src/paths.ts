export const INVITATION_ACCEPT_PATH = '/invite/accept';

export function invitationAcceptanceUrl(publicOrigin: string, token: string): string {
  const link = new URL(INVITATION_ACCEPT_PATH, publicOrigin);
  link.searchParams.set('token', token);
  return link.toString();
}
