import { render, screen, fireEvent } from '@testing-library/react';
import { VariablePanel } from './VariablePanel';
import { useVariablesStore } from '../../data/variablesStore';
import { VARIABLES } from '../../data/variables';

beforeEach(() => {
  useVariablesStore.setState({ variables: VARIABLES.map(v => ({ ...v })) });
});

const systemVar = VARIABLES.find(v => v.readOnly)!;
const userVar = VARIABLES.find(v => v.origin === 'user')!;

test('view mode on a system/readOnly variable shows no Save button and is read-only', () => {
  render(
    <VariablePanel variable={systemVar} mode="view" onClose={() => {}} />
  );
  // Name appears in title and in ReadonlyField — getAllByText is fine
  expect(screen.getAllByText(systemVar.name).length).toBeGreaterThan(0);
  // Lock indicator present
  expect(screen.getByText('🔒')).toBeInTheDocument();
  // No Save button
  expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  // Fields are not editable inputs (only display text)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});

test('edit mode on a user variable: changing defaultMessage and clicking Save calls updateVariable', () => {
  const updateVariable = vi.fn();
  useVariablesStore.setState({ variables: VARIABLES.map(v => ({ ...v })), updateVariable });

  const onClose = vi.fn();
  render(
    <VariablePanel variable={userVar} mode="edit" onClose={onClose} />
  );

  // Find the default message input
  const msgInput = screen.getByDisplayValue(userVar.defaultMessage ?? '');
  fireEvent.change(msgInput, { target: { value: 'New error message' } });

  fireEvent.click(screen.getByRole('button', { name: /save/i }));

  expect(updateVariable).toHaveBeenCalledWith(
    userVar.name,
    expect.objectContaining({ defaultMessage: 'New error message' })
  );
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('create mode: entering a name and clicking Save calls addVariable', () => {
  const addVariable = vi.fn();
  useVariablesStore.setState({ variables: VARIABLES.map(v => ({ ...v })), addVariable });

  const onClose = vi.fn();
  render(
    <VariablePanel variable={null} mode="create" onClose={onClose} />
  );

  const nameInput = screen.getByPlaceholderText(/variable name/i);
  fireEvent.change(nameInput, { target: { value: 'my_new_var' } });

  fireEvent.click(screen.getByRole('button', { name: /save/i }));

  expect(addVariable).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'my_new_var' })
  );
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('overlay click calls onClose', () => {
  const onClose = vi.fn();
  render(
    <VariablePanel variable={userVar} mode="edit" onClose={onClose} />
  );
  fireEvent.click(screen.getByTestId('panel-overlay'));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('close button calls onClose', () => {
  const onClose = vi.fn();
  render(
    <VariablePanel variable={userVar} mode="edit" onClose={onClose} />
  );
  fireEvent.click(screen.getByRole('button', { name: /close/i }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('enum values field appears only when type is enum', () => {
  const enumVar = VARIABLES.find(v => v.type === 'enum')!;
  render(
    <VariablePanel variable={enumVar} mode="edit" onClose={() => {}} />
  );
  expect(screen.getByLabelText(/enum values/i)).toBeInTheDocument();
});

test('create mode origin select does not include "system"', () => {
  render(
    <VariablePanel variable={null} mode="create" onClose={() => {}} />
  );
  const originSelect = screen.getByLabelText(/origin/i);
  expect(originSelect).not.toHaveTextContent('system');
});
