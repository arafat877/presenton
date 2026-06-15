import React from 'react'
import Header from '@/app/(presentation-generator)/(dashboard)/dashboard/components/Header'
import { Metadata } from 'next'
import OutlinePage from './components/OutlinePage'

const ENABLED_FEATURE_FLAG_VALUES = new Set(["1", "true", "yes", "on"]);

function isSlideEditorImportEnabled() {
  const value =
    process.env.USE_SLIDE_EDITOR_IMPORT ??
    process.env.NEXT_PUBLIC_USE_SLIDE_EDITOR_IMPORT ??
    "";

  return ENABLED_FEATURE_FLAG_VALUES.has(value.trim().toLowerCase());
}

export const metadata: Metadata = {
  title: "Outline Presentation",
  description: "Customize and organize your presentation outline. Drag and drop slides, add charts, and generate your presentation with ease.",
  alternates: {
    canonical: "https://presenton.ai/create"
  },
  keywords: [
    "presentation generator",
    "AI presentations",
    "data visualization",
    "automatic presentation maker",
    "professional slides",
    "data-driven presentations",
    "document to presentation",
    "presentation automation",
    "smart presentation tool",
    "business presentations"
  ]
}
const page = () => {
  return (
    <div className='relative min-h-screen'>
      <Header />
      <OutlinePage useTemplateV2Templates={isSlideEditorImportEnabled()} />
    </div>
  )
}

export default page
