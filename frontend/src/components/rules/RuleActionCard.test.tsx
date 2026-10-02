import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@/test/render';
import { RuleActionCard } from './RuleActionCard';
import { testOptions } from './rule-test-harness';
import { COFFEE_ID, PAYEE_ID, TAG_ID } from './rules-test-fixtures';
import { EDITOR_ACTION_TYPES, createAction, type EditableActionType, type EditorAction } from '@/lib/rule-actions';
import {
  MAX_RULE_AI_INSTRUCTION_LENGTH,
  MAX_RULE_DESCRIPTION_TEMPLATE_LENGTH,
  MAX_RULE_PAYEE_TEMPLATE_LENGTH,
} from '@/lib/rule-fields';

Element.prototype.scrollIntoView = vi.fn();

function Card({
  initial,
  types = EDITOR_ACTION_TYPES,
  onAction,
  errors = [],
}: {
  initial: EditorAction;
  types?: readonly EditableActionType[];
  onAction?: (action: EditorAction) => void;
  errors?: string[];
}) {
  const [action, setAction] = useState(initial);
  return (
    <RuleActionCard
      action={action}
      types={types}
      options={testOptions}
      actions={[]}
      errors={errors}
      onChange={(next) => {
        setAction(next);
        onAction?.(next);
      }}
    />
  );
}

const optionLabels = (select: HTMLElement) => within(select).getAllByRole('option').map((o) => o.textContent);

describe('RuleActionCard', () => {
  it('lists the action types it is given, translated', () => {
    render(<Card initial={createAction('add_tags')} types={['add_tags', 'set_payee']} />);
    expect(optionLabels(screen.getByLabelText('Action type'))).toEqual(['Add tags', 'Set the payee']);
  });

  it('lists all seven types when none is held back', () => {
    render(<Card initial={createAction('add_tags')} />);
    expect(optionLabels(screen.getByLabelText('Action type'))).toEqual([
      'Add tags',
      'Remove tags',
      'Set the category',
      'Set the payee',
      'Set the payee from text',
      'Set the description',
      'Ask for an AI review',
    ]);
  });

  it('starts "Only if empty" on when the type is changed to set_category or set_payee', () => {
    const onAction = vi.fn();
    render(<Card initial={createAction('add_tags')} onAction={onAction} />);
    expect(screen.queryByRole('switch', { name: 'Only if empty' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Action type'), { target: { value: 'set_category' } });
    expect(screen.getByRole('switch', { name: 'Only if empty' })).toHaveAttribute('aria-checked', 'true');
    expect(onAction).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'set_category', onlyIfEmpty: true }));

    fireEvent.change(screen.getByLabelText('Action type'), { target: { value: 'set_payee' } });
    expect(screen.getByRole('switch', { name: 'Only if empty' })).toHaveAttribute('aria-checked', 'true');
    expect(onAction).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'set_payee', onlyIfEmpty: true }));
  });

  it('explains what "Only if empty" does not replace', () => {
    render(<Card initial={createAction('set_category')} />);
    const help = screen.getByRole('button', { name: /does not replace one set by hand or by the payee's default category/ });
    expect(help).toBeInTheDocument();
  });

  it('turns "Only if empty" off and keeps the choice', () => {
    const onAction = vi.fn();
    render(<Card initial={createAction('set_payee')} onAction={onAction} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Only if empty' }));
    expect(onAction).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'set_payee', onlyIfEmpty: false }));
    expect(screen.getByRole('switch', { name: 'Only if empty' })).toHaveAttribute('aria-checked', 'false');
  });

  it('picks a category and a payee by name', () => {
    const onAction = vi.fn();
    const { unmount } = render(<Card initial={createAction('set_category')} onAction={onAction} />);
    fireEvent.focus(screen.getByPlaceholderText('Choose a category'));
    fireEvent.click(screen.getByText('Food: Coffee'));
    expect(onAction).toHaveBeenLastCalledWith(expect.objectContaining({ categoryId: COFFEE_ID, onlyIfEmpty: true }));
    unmount();

    render(<Card initial={createAction('set_payee')} onAction={onAction} />);
    fireEvent.focus(screen.getByPlaceholderText('Choose a payee'));
    fireEvent.click(screen.getByText('Corner Cafe'));
    expect(onAction).toHaveBeenLastCalledWith(expect.objectContaining({ payeeId: PAYEE_ID }));
  });

  it('picks tags for add_tags and remove_tags', () => {
    const onAction = vi.fn();
    render(<Card initial={createAction('remove_tags')} onAction={onAction} />);
    fireEvent.click(screen.getByText('Choose tags'));
    fireEvent.click(screen.getByLabelText('Coffee run'));
    expect(onAction).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'remove_tags', tagIds: [TAG_ID] }));
  });

  it('takes the instruction of an AI review, bounded to what the server accepts', () => {
    const onAction = vi.fn();
    render(<Card initial={createAction('request_ai_review')} onAction={onAction} />);
    const box = screen.getByLabelText('What should be checked');
    expect(box).toHaveAttribute('maxlength', String(MAX_RULE_AI_INSTRUCTION_LENGTH));
    fireEvent.change(box, { target: { value: 'Split by the receipt' } });
    expect(onAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'request_ai_review', instruction: 'Split by the receipt' }),
    );
    expect(screen.getByText(/A person approves any change/)).toBeInTheDocument();
  });

  it('shows its errors on the card', () => {
    render(<Card initial={createAction('set_payee')} errors={['REFERENCE_NOT_FOUND']} />);
    expect(screen.getByRole('alert')).toHaveTextContent('An item chosen here no longer exists. Choose another.');
  });

  it('stacks its controls on a phone', () => {
    render(<Card initial={createAction('add_tags')} />);
    const grid = screen.getByLabelText('Action type').closest('.grid');
    expect(grid).toHaveClass('grid-cols-1');
  });

  it('links the AI review action to the review inbox', () => {
    render(<Card initial={createAction('request_ai_review')} />);
    expect(screen.getByRole('link', { name: 'See the review inbox' })).toHaveAttribute('href', '/ai-reviews');
  });

  it('shows no inbox link on the other action types', () => {
    render(<Card initial={createAction('add_tags')} />);
    expect(screen.queryByRole('link', { name: 'See the review inbox' })).not.toBeInTheDocument();
  });

  describe('set_payee_from_text', () => {
    it('starts with the server defaults: fill only, never create', () => {
      const onAction = vi.fn();
      render(<Card initial={createAction('add_tags')} onAction={onAction} />);
      fireEvent.change(screen.getByLabelText('Action type'), { target: { value: 'set_payee_from_text' } });
      expect(onAction).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: 'set_payee_from_text', template: '', createIfMissing: false, onlyIfEmpty: true }),
      );
      expect(screen.getByLabelText('Payee name')).toHaveValue('');
      expect(screen.getByRole('switch', { name: 'Only if empty' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('switch', { name: 'Create the payee if it does not exist' })).toHaveAttribute('aria-checked', 'false');
    });

    it('explains in a tooltip that a payee may be created, and turns the choice on', () => {
      const onAction = vi.fn();
      render(<Card initial={createAction('set_payee_from_text')} onAction={onAction} />);
      expect(screen.getByRole('button', { name: /a new payee is created with it/ })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('switch', { name: 'Create the payee if it does not exist' }));
      expect(onAction).toHaveBeenLastCalledWith(expect.objectContaining({ createIfMissing: true, onlyIfEmpty: true }));
    });

    it('bounds the name like the server does', () => {
      render(<Card initial={createAction('set_payee_from_text')} />);
      expect(screen.getByLabelText('Payee name')).toHaveAttribute('maxlength', String(MAX_RULE_PAYEE_TEMPLATE_LENGTH));
    });
  });

  describe('set_description', () => {
    it('starts with the server defaults: replace, and write even when there is a description', () => {
      const onAction = vi.fn();
      render(<Card initial={createAction('add_tags')} onAction={onAction} />);
      fireEvent.change(screen.getByLabelText('Action type'), { target: { value: 'set_description' } });
      expect(onAction).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: 'set_description', template: '', mode: 'replace', onlyIfEmpty: false }),
      );
      expect(optionLabels(screen.getByLabelText('How to write it'))).toEqual([
        'Replace the description',
        'Add after the description',
        'Add before the description',
      ]);
      expect(screen.getByRole('switch', { name: 'Only if empty' })).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByLabelText('Description text')).toHaveAttribute('maxlength', String(MAX_RULE_DESCRIPTION_TEMPLATE_LENGTH));
    });

    it('changes the mode, and says the text is joined as written only for the modes that join', () => {
      const onAction = vi.fn();
      render(<Card initial={createAction('set_description')} onAction={onAction} />);
      expect(screen.queryByText(/joined to the current description exactly as written/)).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('How to write it'), { target: { value: 'prepend' } });
      expect(onAction).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'prepend' }));
      expect(screen.getByText(/joined to the current description exactly as written/)).toBeInTheDocument();
    });

    it('has its own explanation of "Only if empty"', () => {
      render(<Card initial={createAction('set_description')} />);
      expect(screen.getByRole('button', { name: /writes the description only if the transaction has none/ })).toBeInTheDocument();
    });
  });

  describe('the placeholders of a text action', () => {
    it('lists the two built-ins and the captures of the rule, and inserts one where the cursor is', () => {
      const onAction = vi.fn();
      render(
        <RuleActionCard
          action={{ ...createAction('set_description'), template: 'AB' } as EditorAction}
          types={EDITOR_ACTION_TYPES}
          options={testOptions}
          actions={[]}
          errors={[]}
          captures={['payee', 'ref']}
          onChange={onAction}
        />,
      );
      const names = screen.getAllByRole('button', { name: /^Insert / }).map((b) => b.textContent);
      expect(names).toEqual(['{payeeText}', '{description}', '{payee}', '{ref}']);

      const input = screen.getByLabelText('Description text') as HTMLInputElement;
      input.setSelectionRange(1, 1);
      fireEvent.click(screen.getByRole('button', { name: 'Insert {payee}' }));
      expect(onAction).toHaveBeenLastCalledWith(expect.objectContaining({ template: 'A{payee}B' }));
    });

    it('offers only the built-ins when no pattern captures anything', () => {
      render(<Card initial={createAction('set_payee_from_text')} />);
      expect(screen.getAllByRole('button', { name: /^Insert / }).map((b) => b.textContent)).toEqual([
        '{payeeText}',
        '{description}',
      ]);
    });

    it('flags an unknown placeholder inline, and a malformed one, without repeating them in the card list', () => {
      render(
        <RuleActionCard
          action={{ ...createAction('set_payee_from_text'), template: '{payee} {nope} {Bad}' } as EditorAction}
          types={EDITOR_ACTION_TYPES}
          options={testOptions}
          actions={[]}
          errors={['UNKNOWN_CAPTURE', 'INVALID_CAPTURE', 'VALUE_TOO_LONG']}
          captures={['payee']}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByText(/Not defined by this rule: \{nope\}/)).toBeInTheDocument();
      expect(screen.getByText(/Not a valid placeholder: \{Bad\}/)).toBeInTheDocument();
      expect(screen.getAllByRole('alert')).toHaveLength(1);
      expect(screen.getByRole('alert')).toHaveTextContent('The text is too long.');
    });

    it('does not flag the built-ins or a capture of the rule', () => {
      render(
        <RuleActionCard
          action={{ ...createAction('set_description'), template: '{payee} {payeeText} {description}' } as EditorAction}
          types={EDITOR_ACTION_TYPES}
          options={testOptions}
          actions={[]}
          errors={[]}
          captures={['payee']}
          onChange={vi.fn()}
        />,
      );
      expect(screen.queryByText(/Not defined by this rule/)).not.toBeInTheDocument();
    });

    it('cannot insert a placeholder that would not fit', () => {
      render(
        <Card
          initial={{ ...createAction('set_payee_from_text'), template: 'x'.repeat(MAX_RULE_PAYEE_TEMPLATE_LENGTH - 3) } as EditorAction}
        />,
      );
      expect(screen.getByRole('button', { name: 'Insert {payeeText}' })).toBeDisabled();
    });
  });
});

describe('RuleActionCard: a transfer or a split made through the assistant', () => {
  const ACCOUNT = testOptions.accounts[0].value;
  const convert: EditorAction = {
    uid: 'c1',
    type: 'convert_to_transfer',
    stored: { type: 'convert_to_transfer', toAccountId: ACCOUNT, clearCategory: true },
  };
  const split: EditorAction = {
    uid: 's1',
    type: 'split',
    stored: {
      type: 'split',
      parts: [
        { amount: '{principal}', transferAccountId: ACCOUNT },
        { amount: '{interest}', categoryId: COFFEE_ID },
        { amount: 'rest' },
      ],
    },
  };

  it('is shown as a sentence, read-only, with no type picker and no inputs', () => {
    render(<Card initial={convert} />);
    expect(screen.getByText('Turn into a transfer to Chequing (CAD)')).toBeInTheDocument();
    expect(screen.getByText(/created through the assistant/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Action type')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('reads every part of a split, naming accounts and categories', () => {
    render(<Card initial={split} />);
    expect(
      screen.getByText('Split into: {principal} to Chequing (CAD), {interest} as Food: Coffee, and the rest'),
    ).toBeInTheDocument();
  });

  it('shows the errors the server reported for it', () => {
    render(<Card initial={split} errors={['CONFLICTING_ACTIONS']} />);
    expect(screen.getByText(/cannot be combined with/)).toBeInTheDocument();
  });
});
