import React from 'react'
import TemplatePanel from './components/TemplatePanel'

const ENABLED_FEATURE_FLAG_VALUES = new Set(["1", "true", "yes", "on"]);

function isSlideEditorImportEnabled() {
    const value =
        process.env.USE_SLIDE_EDITOR_IMPORT ??
        process.env.NEXT_PUBLIC_USE_SLIDE_EDITOR_IMPORT ??
        "";

    return ENABLED_FEATURE_FLAG_VALUES.has(value.trim().toLowerCase());
}

const page = () => {
    return (
        <TemplatePanel useTemplateV2Templates={isSlideEditorImportEnabled()} />
    )
}

export default page
