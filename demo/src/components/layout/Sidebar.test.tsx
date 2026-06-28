import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from './Sidebar';
test('sidebar shows all sections', () => {
  render(<MemoryRouter><Sidebar/></MemoryRouter>);
  ['Overview','Promo Codes','Affiliates','Referrals','Loyalty','Variables','Events','Analytics']
    .forEach(l => expect(screen.getByText(l)).toBeInTheDocument());
});
