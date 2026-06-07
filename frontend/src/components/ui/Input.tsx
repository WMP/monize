'use client';

import { forwardRef, useState, InputHTMLAttributes } from 'react';
import { useTranslations } from 'next-intl';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { cn, inputBaseClasses, inputErrorClasses } from '@/lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  prefix?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, prefix, className, id, type, value, ...props }, ref) => {
    const t = useTranslations('ui');
    const inputId = id || `input-${label?.toLowerCase().replace(/\s+/g, '-')}`;
    const isEmptyDate = type === 'date' && value !== undefined && !value;
    const isPassword = type === 'password';
    const [revealed, setRevealed] = useState(false);
    const effectiveType =
      isPassword && revealed ? 'text' : type;

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            {label}
          </label>
        )}
        <div className={prefix || isPassword ? 'relative' : undefined}>
          {prefix && (
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-500 dark:text-gray-400 pointer-events-none">
              {prefix}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            type={effectiveType}
            value={value}
            className={cn(
              inputBaseClasses,
              'border px-3 py-2 focus:ring-1 focus:outline-none',
              error && inputErrorClasses,
              prefix && 'pl-7',
              isPassword && 'pr-10',
              isEmptyDate && 'date-empty',
              className
            )}
            {...props}
          />
          {isPassword && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setRevealed((v) => !v)}
              aria-label={revealed ? t('input.hide') : t('input.show')}
              title={revealed ? t('input.hide') : t('input.show')}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 focus:outline-none"
            >
              {revealed ? (
                <EyeSlashIcon className="h-5 w-5" />
              ) : (
                <EyeIcon className="h-5 w-5" />
              )}
            </button>
          )}
        </div>
        {error && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
