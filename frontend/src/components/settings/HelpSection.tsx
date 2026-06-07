'use client';

import { useTranslations } from 'next-intl';
import {
  ArrowTopRightOnSquareIcon,
  BookOpenIcon,
  ChatBubbleLeftRightIcon,
  CodeBracketIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

interface HelpLink {
  readonly labelKey: string;
  readonly descriptionKey: string;
  readonly href: string;
  readonly Icon: typeof CodeBracketIcon;
}

const REPO_URL = 'https://github.com/kenlasko/monize';

const HELP_LINKS: readonly HelpLink[] = [
  {
    labelKey: 'help.github',
    descriptionKey: 'help.githubDescription',
    href: REPO_URL,
    Icon: CodeBracketIcon,
  },
  {
    labelKey: 'help.openIssue',
    descriptionKey: 'help.openIssueDescription',
    href: `${REPO_URL}/issues/new`,
    Icon: ExclamationTriangleIcon,
  },
  {
    labelKey: 'help.discussions',
    descriptionKey: 'help.discussionsDescription',
    href: `${REPO_URL}/discussions`,
    Icon: ChatBubbleLeftRightIcon,
  },
  {
    labelKey: 'help.wiki',
    descriptionKey: 'help.wikiDescription',
    href: `${REPO_URL}/wiki`,
    Icon: BookOpenIcon,
  },
] as const;

export function HelpSection() {
  const t = useTranslations('settings');
  return (
    <div className="bg-white dark:bg-gray-800 shadow dark:shadow-gray-700/50 rounded-lg p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
        {t('help.title')}
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        {t('help.description')}
      </p>
      <ul className="space-y-2">
        {HELP_LINKS.map(({ labelKey, descriptionKey, href, Icon }) => (
          <li key={href}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-md border border-gray-200 dark:border-gray-700 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <Icon className="h-6 w-6 shrink-0 text-gray-400 dark:text-gray-500" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">
                  {t(labelKey)}
                </span>
                <span className="block text-sm text-gray-500 dark:text-gray-400">
                  {t(descriptionKey)}
                </span>
              </span>
              <ArrowTopRightOnSquareIcon className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
