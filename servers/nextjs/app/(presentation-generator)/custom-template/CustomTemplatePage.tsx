"use client";



import React, { useEffect, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/components/ui/sonner";
import {
    TEMPLATE_IMPORT_QUERY_PARAM,
    stageTemplateDeckImport,
} from "@/components/slide-editor/lib/pptx-import-handoff";
import {
    adaptTemplateV2ResponseToDeck,
    normalizeTemplateV2Fonts,
    type TemplateV2ImportResponse,
} from "@/components/slide-editor/lib/template-v2-import";
import { getHeader } from "@/app/(presentation-generator)/services/api/header";
import { ApiResponseHandler } from "@/app/(presentation-generator)/services/api/api-error-handler";
import { getApiUrl } from "@/utils/api";



import { useFileUpload } from "./hooks/useFileUpload";
import { useTemplateCreation } from "./hooks/useTemplateCreation";
import { useLayoutSaving } from "./hooks/useLayoutSaving";

import { ProcessedSlide } from "./types";
import { TAILWIND_CDN_URL } from "./constants";
import { TemplateStudioHeader } from "./components/TemplateStudioHeader";
import { TemplateCreationProgress } from "./components/TemplateCreationProgress";
import { Step2FontManagement } from "./components/steps/Step2FontManagement";
import { Step3SlidePreview } from "./components/steps/Step3SlidePreview";
import { Step4TemplateCreation } from "./components/steps/Step4TemplateCreation";
import { SaveLayoutButton } from "./components/SaveLayoutButton";
import { SaveLayoutModal } from "./components/SaveLayoutModal";
import { FileUploadSection } from "./components/FileUploadSection";
import { SlideEditorFontImportDialog } from "./components/SlideEditorFontImportDialog";
import { useSlideEditorFontImport } from "./hooks/useSlideEditorFontImport";

import { useFontLoader as loadFontAssets } from "../hooks/useFontLoad";
import Header from "@/app/(presentation-generator)/(dashboard)/dashboard/components/Header";





type CustomTemplatePageProps = {
    useSlideEditorImport?: boolean;
};

const CustomTemplatePage = ({
    useSlideEditorImport = false,
}: CustomTemplatePageProps) => {
    const router = useRouter();

    const [schemaEditorSlideIndex, setSchemaEditorSlideIndex] = useState<number | null>(null);
    const [schemaPreviewData, setSchemaPreviewData] = useState<Record<number, Record<string, any>>>({});
    const [isOpeningSlideEditor, setIsOpeningSlideEditor] = useState(false);
    const [isSlideEditorFontDialogOpen, setIsSlideEditorFontDialogOpen] = useState(false);

    const { selectedFile, handleFileSelect, removeFile } = useFileUpload();
    const {
        file: slideEditorImportFile,
        fontsData: slideEditorImportFontsData,
        uploadedFonts: slideEditorUploadedFonts,
        isCheckingFonts: isCheckingSlideEditorFonts,
        isPreparingImport: isPreparingSlideEditorImport,
        error: slideEditorFontImportError,
        checkFonts: checkSlideEditorImportFonts,
        uploadFont: uploadSlideEditorImportFont,
        removeFont: removeSlideEditorImportFont,
        prepareImport: prepareSlideEditorImport,
        reset: resetSlideEditorFontImport,
    } = useSlideEditorFontImport();


    const {
        state,
        uploadedFonts,
        slides,
        setSlides,
        completedSlides,
        checkFonts,
        uploadFont,
        removeFont,
        fontUploadAndPreview,
        initTemplateCreation,
        retrySlide,
    } = useTemplateCreation();

    // Layout saving hook
    const {
        isSavingLayout,
        isModalOpen,
        openSaveModal,
        closeSaveModal,
        saveLayout,
    } = useLayoutSaving(slides);


    useEffect(() => {
        const existingScript = document.querySelector('script[src*="tailwindcss.com"]');
        if (!existingScript) {
            const script = document.createElement("script");
            script.src = TAILWIND_CDN_URL;
            script.async = true;
            document.head.appendChild(script);
        }
    }, []);


    /**
     * Step 1: Check fonts in uploaded PPTX
     */
    const handleCheckFonts = useCallback(async () => {


        if (selectedFile) {
            await checkFonts(selectedFile);
        }
    }, [selectedFile, checkFonts]);

    /**
     * Step 2: Upload fonts and generate preview
     */
    const handleFontUploadAndPreview = useCallback(async () => {
        if (selectedFile) {
            const data = await fontUploadAndPreview(selectedFile);
            if (data) {
                loadFontAssets(data.fonts);
            }
        }
    }, [selectedFile, fontUploadAndPreview]);

    /**
     * Step 5: Save template with metadata
     */
    const handleSaveTemplate = useCallback(async (
        layoutName: string,
        description: string,
        template_info_id: string
    ): Promise<string | null> => {
        const id = await saveLayout(layoutName, description, template_info_id);
        if (id) {
            router.push(`/template-preview?slug=custom-${id}`);
        }
        return id;
    }, [saveLayout, router]);

    const handleCreateTemplateAndOpenSlideEditor = useCallback(async (
        preparedImport: {
            modified_pptx_url: string;
            slide_image_urls: string[];
            fonts: Record<string, string>;
        }
    ) => {
        setIsOpeningSlideEditor(true);
        try {
            if (!preparedImport.slide_image_urls.length) {
                throw new Error("The backend did not return slide preview images.");
            }

            const response = await fetch(getApiUrl("/api/v2/templates"), {
                method: "POST",
                headers: getHeader(),
                body: JSON.stringify({
                    pptx_url: preparedImport.modified_pptx_url,
                    slide_image_urls: preparedImport.slide_image_urls,
                    fonts: preparedImport.fonts,
                }),
            });

            const template = (await ApiResponseHandler.handleResponse(
                response,
                "Failed to create the slide editor template"
            )) as TemplateV2ImportResponse;
            const deck = adaptTemplateV2ResponseToDeck(template);
            const fonts = normalizeTemplateV2Fonts(template, preparedImport.fonts);

            if (Object.keys(fonts).length > 0) {
                loadFontAssets(fonts);
            }

            const importId = await stageTemplateDeckImport(deck, {
                fonts,
                templateId: typeof template.id === "string" ? template.id : undefined,
            });
            const params = new URLSearchParams({
                [TEMPLATE_IMPORT_QUERY_PARAM]: importId,
            });
            router.push(`/slide-editor?${params.toString()}`);
        } catch (error) {
            console.error("Could not open backend template in slide editor:", error);
            notify.error(
                "Import failed",
                error instanceof Error
                    ? error.message
                    : "Could not open this template in the editor."
            );
            setIsOpeningSlideEditor(false);
        }
    }, [router]);

    const handleOpenEditorWithPptx = useCallback(async (pptxFile: File) => {
        const lowerName = pptxFile.name.toLowerCase();
        if (!lowerName.endsWith(".pptx")) {
            notify.error("Invalid file", "Please select a valid PPTX file.");
            return;
        }

        const maxSize = 100 * 1024 * 1024;
        if (pptxFile.size > maxSize) {
            notify.error("File too large", "File size must be less than 100MB.");
            return;
        }

        setIsOpeningSlideEditor(true);
        try {
            setIsSlideEditorFontDialogOpen(true);
            await checkSlideEditorImportFonts(pptxFile);
        } catch (error) {
            console.error("Could not check PPTX fonts:", error);
            notify.error(
                "Font check failed",
                error instanceof Error
                    ? error.message
                    : "Could not check fonts for this PPTX."
            );
        } finally {
            setIsOpeningSlideEditor(false);
        }
    }, [checkSlideEditorImportFonts]);

    const handleCancelSlideEditorFontImport = useCallback(() => {
        if (isPreparingSlideEditorImport) return;
        setIsSlideEditorFontDialogOpen(false);
        resetSlideEditorFontImport();
        setIsOpeningSlideEditor(false);
    }, [isPreparingSlideEditorImport, resetSlideEditorFontImport]);

    const handleOpenWithPreparedFonts = useCallback(async () => {
        const preparedImport = await prepareSlideEditorImport();
        if (!preparedImport) return;

        await handleCreateTemplateAndOpenSlideEditor(preparedImport);
    }, [handleCreateTemplateAndOpenSlideEditor, prepareSlideEditorImport]);

    const handleOpenWithoutFontCheck = useCallback(async () => {
        if (!slideEditorImportFile) {
            notify.error("No PPTX selected", "Please choose a PPTX file first.");
            return;
        }

        const preparedImport = await prepareSlideEditorImport();
        if (!preparedImport) return;

        await handleCreateTemplateAndOpenSlideEditor(preparedImport);
    }, [
        handleCreateTemplateAndOpenSlideEditor,
        prepareSlideEditorImport,
        slideEditorImportFile,
    ]);

    /**
     * Update a specific slide's data
     */
    const handleSlideUpdate = useCallback((index: number, updatedSlideData: Partial<ProcessedSlide>) => {
        setSlides((prevSlides) =>
            prevSlides.map((s, i) =>
                i === index
                    ? { ...s, ...updatedSlideData, modified: true }
                    : s
            )
        );
    }, [setSlides]);


    /**
     * Open schema editor for a specific slide
     */
    const handleOpenSchemaEditor = useCallback((index: number | null) => {
        setSchemaEditorSlideIndex(index);
    }, []);

    /**
     * Close schema editor
     */
    const handleCloseSchemaEditor = useCallback(() => {
        setSchemaEditorSlideIndex(null);
    }, []);

    /**
     * Save changes from schema editor
     */
    const handleSchemaEditorSave = useCallback((updatedReact: string) => {
        if (schemaEditorSlideIndex !== null) {
            setSlides(prev => prev.map((s, i) =>
                i === schemaEditorSlideIndex ? { ...s, react: updatedReact } : s
            ));
        }
        setSchemaEditorSlideIndex(null);
    }, [schemaEditorSlideIndex, setSlides]);

    /**
     * Update schema preview content (for AI fill)
     */
    const handleSchemaPreviewContent = useCallback((content: Record<string, any>) => {
        if (schemaEditorSlideIndex !== null) {
            setSchemaPreviewData(prev => ({
                ...prev,
                [schemaEditorSlideIndex]: content
            }));
        }
    }, [schemaEditorSlideIndex]);

    /**
     * Clear schema preview data for a specific slide
     */
    const handleClearSchemaPreview = useCallback((slideIndex: number) => {
        setSchemaPreviewData(prev => {
            const newData = { ...prev };
            delete newData[slideIndex];
            return newData;
        });
    }, []);



    const showFileUpload = state.step === 'file-upload';
    const showFontManager = state.step === 'font-check' || state.step === 'font-upload';
    const showPreview = state.step === 'slides-preview';
    const showSlides = state.step === 'template-creation' || state.step === 'completed';
    const isProcessingCompleted = state.step === 'completed';



    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">

            <Header />
            <TemplateStudioHeader />
            <SlideEditorFontImportDialog
                open={isSlideEditorFontDialogOpen}
                fileName={slideEditorImportFile?.name}
                fontsData={slideEditorImportFontsData}
                uploadedFonts={slideEditorUploadedFonts}
                isChecking={isCheckingSlideEditorFonts}
                isPreparing={isPreparingSlideEditorImport || isOpeningSlideEditor}
                error={slideEditorFontImportError}
                uploadFont={uploadSlideEditorImportFont}
                removeFont={removeSlideEditorImportFont}
                onCancel={handleCancelSlideEditorFontImport}
                onOpenWithoutFontCheck={handleOpenWithoutFontCheck}
                onOpenWithFonts={handleOpenWithPreparedFonts}
            />
            {showFileUpload ? (
                <div className="pb-24">
                    <FileUploadSection
                        selectedFile={selectedFile}
                        handleFileSelect={handleFileSelect}
                        removeFile={removeFile}
                        CheckFonts={handleCheckFonts}
                        isProcessingPptx={
                            state.isLoading ||
                            (useSlideEditorImport && isOpeningSlideEditor)
                        }
                        processingLabel={
                            useSlideEditorImport && isOpeningSlideEditor
                                ? "Opening editor..."
                                : undefined
                        }
                        onPptxFileSelect={
                            useSlideEditorImport ? handleOpenEditorWithPptx : undefined
                        }
                        slides={[]}
                        completedSlides={0}
                    />

                </div>
            ) : (
                <div className="mx-auto min-h-[600px] px-6 pb-24">

                    <TemplateCreationProgress
                        currentStep={state.step}
                        totalSlides={state.totalSlides}
                        processedSlides={completedSlides}
                    />

                    {/* Step 2: Font Management */}
                    {showFontManager && (
                        <Step2FontManagement
                            fontsData={state.fontsData}
                            uploadedFonts={uploadedFonts}
                            uploadFont={uploadFont}
                            removeFont={removeFont}
                            onContinue={handleFontUploadAndPreview}
                            isUploading={state.isLoading}
                        />
                    )}

                    {/* Step 3: Slide Preview */}
                    {showPreview && (
                        <Step3SlidePreview
                            previewData={state.previewData}
                            onInitTemplate={initTemplateCreation}
                            isLoading={state.isLoading}
                        />
                    )}

                    {/* Step 4: Template Creation & Editing */}
                    {showSlides && slides.length > 0 && (
                        <Step4TemplateCreation
                            slides={slides}
                            setSlides={setSlides}
                            retrySlide={retrySlide}
                            onSlideUpdate={handleSlideUpdate}
                            schemaEditorSlideIndex={schemaEditorSlideIndex}
                            onOpenSchemaEditor={handleOpenSchemaEditor}
                            onCloseSchemaEditor={handleCloseSchemaEditor}
                            onSchemaEditorSave={handleSchemaEditorSave}
                            schemaPreviewData={schemaPreviewData}
                            onSchemaPreviewContent={handleSchemaPreviewContent}
                            onClearSchemaPreview={handleClearSchemaPreview}
                        />
                    )}

                    {/* Floating Save Template Button */}
                    {isProcessingCompleted && slides.some((s) => s.processed) && (
                        <SaveLayoutButton
                            onSave={openSaveModal}
                            isSaving={isSavingLayout}
                            isProcessing={slides.some((s) => s.processing)}
                        />
                    )}

                    {/* Save Template Modal */}
                    <SaveLayoutModal
                        isOpen={isModalOpen}
                        onClose={closeSaveModal}
                        onSave={handleSaveTemplate}
                        isSaving={isSavingLayout}
                        template_info_id={state.templateId || ''}
                    />
                </div>
            )}

        </div>
    );
};

export default CustomTemplatePage;
