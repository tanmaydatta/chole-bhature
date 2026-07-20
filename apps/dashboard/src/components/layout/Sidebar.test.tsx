import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from './Sidebar';
test('sidebar shows all sections', () => {
  render(<MemoryRouter><Sidebar session={{
    userId: 'test-user', authenticationMethods: ['magic-link'],
    authenticatedAt: '2026-07-20T10:00:00.000Z', organizationId: 'test-org',
    merchantId: 'test-merchant', membershipId: 'test-membership',
    permissions: ['programs:read', 'schemas:read'], merchantSelectionRequired: false,
  }}/></MemoryRouter>);
  ['Overview','Promo Codes','Affiliates','Referrals','Loyalty','Variables','Events','Analytics']
    .forEach(l => expect(screen.getByText(l)).toBeInTheDocument());
});
