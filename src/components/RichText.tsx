import React from 'react';
import { richTextToHtml } from '../utils/richText';

interface RichTextProps {
  /** 지문/보기/해설 등 HTML·LaTeX가 포함된 문자열 */
  content: string;
  /** 루트 태그 (기본 span) */
  as?: 'span' | 'p' | 'div';
  className?: string;
}

/**
 * HTML(<br>, <b> 등)과 LaTeX($...$, $$...$$)를 렌더링하는 컴포넌트
 */
export const RichText: React.FC<RichTextProps> = ({ content, as: Tag = 'span', className }) => {
  const html = richTextToHtml(content);
  if (!html) return <Tag className={className} />;
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />;
};
