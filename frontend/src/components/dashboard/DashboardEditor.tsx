'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ResolvedDashboardWidget } from './widget-registry';

interface DashboardEditorProps {
  items: ResolvedDashboardWidget[];
  onToggle: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onReorder: (fromId: string, toId: string) => void;
}

export function DashboardEditor({ items, onToggle, onMove, onReorder }: DashboardEditorProps) {
  const t = useTranslations('dashboard');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  return (
    <div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
        {t('edit.dragHint')}
      </p>
      <ul className="space-y-2">
        {items.map((item, index) => {
          const { entry, visible } = item;
          const name = t(entry.nameKey as never);
          const isDragTarget = dragOverId === entry.id && draggingId !== entry.id;
          return (
            <li
              key={entry.id}
              draggable
              onDragStart={(e) => {
                // setData + effectAllowed are required or the browser refuses
                // to fire drop (notably outside Chrome).
                e.dataTransfer.setData('text/plain', entry.id);
                e.dataTransfer.effectAllowed = 'move';
                setDraggingId(entry.id);
              }}
              onDragEnd={() => {
                setDraggingId(null);
                setDragOverId(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (draggingId && draggingId !== entry.id) setDragOverId(entry.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (draggingId && draggingId !== entry.id) {
                  onReorder(draggingId, entry.id);
                }
                setDraggingId(null);
                setDragOverId(null);
              }}
              className={`flex items-center gap-3 rounded-lg border p-3 bg-white dark:bg-gray-800 transition-colors ${
                isDragTarget
                  ? 'border-blue-500 dark:border-blue-400'
                  : 'border-gray-200 dark:border-gray-700'
              } ${!visible ? 'opacity-60' : ''}`}
            >
              <span
                className="cursor-grab text-gray-400 dark:text-gray-500 select-none"
                aria-label={t('edit.dragHandle', { name })}
                role="img"
              >
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M7 4a1 1 0 100 2 1 1 0 000-2zm0 5a1 1 0 100 2 1 1 0 000-2zm0 5a1 1 0 100 2 1 1 0 000-2zm6-10a1 1 0 100 2 1 1 0 000-2zm0 5a1 1 0 100 2 1 1 0 000-2zm0 5a1 1 0 100 2 1 1 0 000-2z" />
                </svg>
              </span>

              <span className="flex-1 min-w-0 truncate font-medium text-gray-900 dark:text-gray-100">
                {name}
              </span>

              <button
                type="button"
                onClick={() => onMove(entry.id, 'up')}
                disabled={index === 0}
                aria-label={t('edit.moveUp', { name })}
                className="p-1.5 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => onMove(entry.id, 'down')}
                disabled={index === items.length - 1}
                aria-label={t('edit.moveDown', { name })}
                className="p-1.5 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              <button
                type="button"
                onClick={() => onToggle(entry.id)}
                aria-pressed={visible}
                aria-label={visible ? t('edit.hideWidget', { name }) : t('edit.showWidget', { name })}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  visible
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {visible ? t('edit.visible') : t('edit.hidden')}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
