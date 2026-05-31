'use client';

import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

const saveAsSchema = z.object({
  // Trim then cap at 255 chars so the submitted value is always clean and
  // bounded, mirroring the backend column limit. A whitespace-only name
  // collapses to '' and fails the min(1) rule.
  name: z
    .string()
    .transform((v) => v.trim().slice(0, 255))
    .pipe(z.string().min(1, 'Name is required')),
});

type SaveAsFormData = { name: string };

interface MonteCarloSaveAsDialogProps {
  isOpen: boolean;
  initialName: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}

export function MonteCarloSaveAsDialog({
  isOpen,
  initialName,
  onCancel,
  onSubmit,
}: MonteCarloSaveAsDialogProps) {
  const {
    control,
    register,
    handleSubmit,
    reset,
  } = useForm<SaveAsFormData>({
    resolver: zodResolver(saveAsSchema),
    defaultValues: { name: initialName },
  });

  // Reset the field whenever the dialog transitions from closed to open. We
  // store the previous open state and update during render so the field
  // already shows the correct value on the first paint -- no useEffect, no
  // cascading re-render.
  const [prevOpen, setPrevOpen] = useState(isOpen);
  if (prevOpen !== isOpen) {
    setPrevOpen(isOpen);
    if (isOpen) reset({ name: initialName });
  }

  const name = useWatch({ control, name: 'name' });

  const submit = ({ name: cleaned }: SaveAsFormData) => {
    onSubmit(cleaned);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      maxWidth="md"
      className="p-6"
      pushHistory
    >
      <form onSubmit={handleSubmit(submit)}>
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
          Save scenario as
        </h3>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Enter a name for this scenario. Keep the existing name to overwrite.
        </p>
        <label
          htmlFor="mc-save-as-name"
          className="block mt-4 text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Name
        </label>
        <input
          id="mc-save-as-name"
          type="text"
          maxLength={255}
          autoFocus
          className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          {...register('name')}
        />
        <div className="mt-6 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!name?.trim()}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
