import { Ionicons } from "@expo/vector-icons";
import { getListMyDocumentsQueryKey, useDeleteDocument, useListMyDocuments } from "@workspace/api-client-react";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { WebView } from "react-native-webview";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { getNativeSessionToken, getNativeSessionUserId } from "@/context/AuthContext";
import { cleanupTempDownload, downloadAndShare } from "@/lib/native-download";
import {
  cleanupInterruptedDocumentUploads,
  cleanupStagedDocument,
  DocumentUploadError,
  pickAndStageDocument,
  type DocumentUploadProgress,
  type StagedDocument,
  uploadStagedDocument,
} from "@/lib/document-upload";

const PRIVATE_UPLOAD_PATH = /^\/objects\/uploads\/[A-Za-z0-9_-]{1,128}$/;

function fileSizeLabel(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "Size unavailable";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function transferSizeLabel(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : fileSizeLabel(bytes);
}

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

interface PdfViewerFile {
  uri: string;
  filename: string;
  ownerId: string;
}

export default function DocumentsScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const documentsQuery = useListMyDocuments({
    query: {
      queryKey: [...getListMyDocumentsQueryKey(), user?.id ?? "anonymous"],
      enabled: !!user?.id && user.role === "candidate",
      refetchOnMount: "always",
      retry: 1,
    },
  });
  const deleteDocument = useDeleteDocument();

  const [stagedDocument, setStagedDocument] = useState<StagedDocument | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<DocumentUploadProgress | null>(null);
  const [uploadAttempted, setUploadAttempted] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [pdfViewer, setPdfViewer] = useState<PdfViewerFile | null>(null);
  const [pdfViewerError, setPdfViewerError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const cancelReasonRef = useRef<"user" | "background" | null>(null);
  const stagedDocumentRef = useRef<StagedDocument | null>(null);
  const pdfViewerRef = useRef<PdfViewerFile | null>(null);
  const mountedRef = useRef(true);

  function updateStagedDocument(value: StagedDocument | null) {
    stagedDocumentRef.current = value;
    setStagedDocument(value);
  }

  function updatePdfViewer(value: PdfViewerFile | null) {
    pdfViewerRef.current = value;
    setPdfViewer(value);
  }

  useEffect(() => {
    mountedRef.current = true;
    try {
      cleanupInterruptedDocumentUploads();
    } catch {
      setUploadError("JOBSAGE could not clear an interrupted upload. Restart the app before selecting another document.");
    }

    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" && controllerRef.current) {
        cancelReasonRef.current = "background";
        controllerRef.current.abort();
      }
    });

    return () => {
      mountedRef.current = false;
      if (controllerRef.current) {
        cancelReasonRef.current = "background";
        controllerRef.current.abort();
      }
      const pending = stagedDocumentRef.current;
      if (pending) {
        try {
          cleanupStagedDocument(pending);
        } catch {
          // The next app startup retries cleanup of the private staging folder.
        }
      }
      const openPdf = pdfViewerRef.current;
      if (openPdf) {
        try {
          cleanupTempDownload(openPdf.uri, openPdf.ownerId);
        } catch {
          // Keep the tracked cache entry for the next owner-scoped cleanup.
        }
      }
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const openPdf = pdfViewerRef.current;
    if (openPdf && openPdf.ownerId !== user?.id) closePdfViewer();
  }, [user?.id]);

  async function chooseDocument() {
    setIsPicking(true);
    try {
      const selected = await pickAndStageDocument();
      if (!mountedRef.current) {
        if (selected) cleanupStagedDocument(selected);
        return;
      }
      if (!selected) return;

      setUploadError(null);
      setNotice(null);
      setUploadAttempted(false);
      setUploadProgress(null);
      const previous = stagedDocumentRef.current;
      if (previous) {
        try {
          cleanupStagedDocument(previous);
        } catch {
          cleanupStagedDocument(selected);
          throw new DocumentUploadError("The previous temporary file could not be cleared. Restart JOBSAGE and try again.");
        }
      }
      updateStagedDocument(selected);
    } catch (error) {
      if (mountedRef.current) {
        setUploadError(readableError(error, "The document could not be selected."));
      }
    } finally {
      if (mountedRef.current) setIsPicking(false);
    }
  }

  async function cancelSelectedDocument() {
    const selected = stagedDocumentRef.current;
    if (!selected) return;
    try {
      cleanupStagedDocument(selected);
      updateStagedDocument(null);
      setUploadAttempted(false);
      setUploadProgress(null);
      setUploadError(null);
      setNotice("The selected file was cleared from this device.");
    } catch {
      updateStagedDocument(null);
      setUploadError("The selected file could not be cleared now. JOBSAGE will retry cleanup on next startup.");
    }
  }

  async function startUpload() {
    const selected = stagedDocumentRef.current;
    if (!selected || controllerRef.current) return;

    const controller = new AbortController();
    controllerRef.current = controller;
    cancelReasonRef.current = null;
    setIsUploading(true);
    setUploadAttempted(true);
    setUploadProgress(null);
    setUploadError(null);
    setNotice(null);

    try {
      try {
        await uploadStagedDocument(selected, controller.signal, (progress) => {
          if (mountedRef.current) setUploadProgress(progress);
        });
      } catch (error) {
        if (!mountedRef.current) {
          try {
            cleanupStagedDocument(selected);
          } catch {
            // The app-owned folder is cleared again on next startup.
          }
          return;
        }
        if (controller.signal.aborted && cancelReasonRef.current === "user") {
          setUploadProgress(null);
          try {
            cleanupStagedDocument(selected);
            updateStagedDocument(null);
            setUploadAttempted(false);
            setNotice("Upload cancelled and its temporary copy was cleared.");
          } catch {
            updateStagedDocument(null);
            setUploadAttempted(false);
            setUploadError("Upload cancelled. JOBSAGE will retry clearing the temporary copy on next startup.");
          }
        } else if (controller.signal.aborted) {
          setUploadError("Upload paused when JOBSAGE left the foreground. Return here and retry.");
        } else {
          setUploadError(readableError(error, "Upload failed. Your selected file is ready to retry."));
        }
        return;
      }

      let cleanupFailed = false;
      try {
        cleanupStagedDocument(selected);
      } catch {
        cleanupFailed = true;
      }
      if (!mountedRef.current) return;

      updateStagedDocument(null);
      setUploadAttempted(false);
      setUploadProgress(null);
      let listRefreshFailed = false;
      try {
        await queryClient.invalidateQueries({ queryKey: getListMyDocumentsQueryKey() });
      } catch {
        listRefreshFailed = true;
      }
      if (mountedRef.current) {
        if (listRefreshFailed) {
          setNotice(`${selected.filename} was uploaded, but the list could not refresh. Use Refresh to check it.`);
        } else if (cleanupFailed) {
          setNotice(`${selected.filename} was uploaded. Its temporary copy will be cleared on next startup.`);
        } else {
          setNotice(`${selected.filename} was uploaded.`);
        }
      }
    } finally {
      controllerRef.current = null;
      if (mountedRef.current) setIsUploading(false);
    }
  }

  function cancelUpload() {
    if (!controllerRef.current) return;
    cancelReasonRef.current = "user";
    controllerRef.current.abort();
  }

  async function downloadDocument(
    documentId: number,
    storageKey: string,
    filename: string,
    viewPdf = false,
  ) {
    if (!PRIVATE_UPLOAD_PATH.test(storageKey)) {
      setUploadError("This document has an invalid private storage location.");
      return;
    }

    const token = getNativeSessionToken();
    if (!token) {
      setUploadError("Please sign in again before downloading this document.");
      return;
    }
    const ownerId = getNativeSessionUserId();
    if (!ownerId || ownerId !== user?.id) {
      setUploadError("Your signed-in account changed. Sign in again before downloading this document.");
      return;
    }

    setDownloadingId(documentId);
    setUploadError(null);
    setNotice(null);
    setPdfViewerError(null);
    try {
      const path = `/api/storage/objects/${storageKey.slice("/objects/".length)}`;
      const downloaded = await downloadAndShare({
        url: path,
        filename,
        token,
        ...(viewPdf ? { share: false } : {}),
      });
      if (viewPdf) {
        if (!mountedRef.current) {
          cleanupTempDownload(downloaded.uri, ownerId);
          return;
        }
        updatePdfViewer({ uri: downloaded.uri, filename: downloaded.filename, ownerId });
      } else if (mountedRef.current) {
        setNotice(`${filename} is ready to open or share.`);
      }
    } catch (error) {
      if (mountedRef.current) {
        setUploadError(readableError(error, "The document could not be downloaded."));
      }
    } finally {
      if (mountedRef.current) setDownloadingId(null);
    }
  }

  function closePdfViewer() {
    const openPdf = pdfViewerRef.current;
    updatePdfViewer(null);
    setPdfViewerError(null);
    if (!openPdf) return;
    try {
      cleanupTempDownload(openPdf.uri, openPdf.ownerId);
    } catch {
      setUploadError("The PDF viewer closed, but its temporary copy could not be cleared. It will be retried during cleanup.");
    }
  }

  async function removeDocument(documentId: number) {
    if (confirmDeleteId !== documentId) {
      setConfirmDeleteId(documentId);
      return;
    }

    setDeletingId(documentId);
    setUploadError(null);
    setNotice(null);
    try {
      await deleteDocument.mutateAsync({ id: documentId });
      await queryClient.invalidateQueries({ queryKey: getListMyDocumentsQueryKey() });
      if (mountedRef.current) {
        setConfirmDeleteId(null);
        setNotice("Document deleted.");
      }
    } catch (error) {
      if (mountedRef.current) {
        setUploadError(readableError(error, "The document could not be deleted. Please retry."));
      }
    } finally {
      if (mountedRef.current) setDeletingId(null);
    }
  }

  const documents = documentsQuery.data?.documents ?? [];

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/companion"))}
            style={({ pressed }) => [
              styles.backButton,
              { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name="arrow-back" size={20} color={colors.foreground} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
              CV and documents
            </Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Upload and manage files for your JOBSAGE applications.
            </Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.sectionHeading}>
            <View style={[styles.iconWrap, { backgroundColor: colors.muted }]}>
              <Ionicons name="cloud-upload-outline" size={20} color={colors.accent} />
            </View>
            <View style={styles.grow}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Add a document</Text>
              <Text style={[styles.description, { color: colors.mutedForeground }]}>
                PDF, JPG, PNG, DOC, DOCX, or TXT · up to 5 MB. Files remain private to your account.
              </Text>
            </View>
          </View>

          {stagedDocument ? (
            <View style={[styles.selectedFile, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Ionicons name="document-text-outline" size={21} color={colors.accent} />
              <View style={styles.grow}>
                <Text numberOfLines={2} style={[styles.fileName, { color: colors.foreground }]}>
                  {stagedDocument.filename}
                </Text>
                <Text style={[styles.fileDetail, { color: colors.mutedForeground }]}>
                  {fileSizeLabel(stagedDocument.size)}
                </Text>
              </View>
            </View>
          ) : null}

          {isUploading ? (
            <View style={[styles.uploadingRow, { backgroundColor: colors.secondary }]}>
              <View style={styles.transferStatus}>
                <ActivityIndicator color={colors.accent} />
                <Text accessibilityLiveRegion="polite" style={[styles.uploadingText, { color: colors.foreground }]}>
                  {uploadProgress
                    ? `${uploadProgress.percent}% sent · ${transferSizeLabel(uploadProgress.loaded)} of ${transferSizeLabel(uploadProgress.total)}`
                    : "Preparing secure upload…"}
                </Text>
              </View>
              {uploadProgress ? (
                <View
                  accessible
                  accessibilityRole="progressbar"
                  accessibilityLabel="Upload progress"
                  accessibilityValue={{
                    min: 0,
                    max: 100,
                    now: uploadProgress.percent,
                    text: `${uploadProgress.percent}%`,
                  }}
                  style={[styles.progressTrack, { backgroundColor: colors.border }]}
                >
                  <View
                    style={[
                      styles.progressFill,
                      { backgroundColor: colors.accent, width: `${uploadProgress.percent}%` },
                    ]}
                  />
                </View>
              ) : null}
            </View>
          ) : null}
          {!isUploading && uploadProgress && uploadError ? (
            <Text accessibilityLiveRegion="polite" style={[styles.fileDetail, { color: colors.mutedForeground }]}>
              Transfer stopped at {uploadProgress.percent}%. Retrying starts the upload again.
            </Text>
          ) : null}

          <View style={styles.actions}>
            {!stagedDocument ? (
              <PrimaryButton
                label={isPicking ? "Opening file picker…" : "Choose a document"}
                icon={isPicking ? "hourglass-outline" : "folder-open-outline"}
                disabled={isPicking}
                colors={colors}
                onPress={() => void chooseDocument()}
              />
            ) : (
              <>
                <PrimaryButton
                  label={isUploading ? "Uploading…" : uploadAttempted ? "Retry upload" : "Upload document"}
                  icon="cloud-upload-outline"
                  disabled={isUploading}
                  colors={colors}
                  onPress={() => void startUpload()}
                />
                {isUploading ? (
                  <SecondaryButton
                    label="Cancel upload"
                    icon="close-circle-outline"
                    colors={colors}
                    onPress={cancelUpload}
                  />
                ) : (
                  <>
                    <SecondaryButton
                      label="Clear selected file"
                      icon="close-outline"
                      colors={colors}
                      onPress={() => void cancelSelectedDocument()}
                    />
                  </>
                )}
              </>
            )}
          </View>
        </View>

        {uploadError ? (
          <View
            accessibilityLiveRegion="polite"
            style={[styles.feedback, { backgroundColor: colors.destructive + "14", borderColor: colors.destructive }]}
          >
            <Ionicons name="alert-circle-outline" size={19} color={colors.destructive} />
            <Text style={[styles.feedbackText, { color: colors.foreground }]}>{uploadError}</Text>
          </View>
        ) : null}
        {notice ? (
          <View
            accessibilityLiveRegion="polite"
            style={[styles.feedback, { backgroundColor: colors.secondary, borderColor: colors.border }]}
          >
            <Ionicons name="checkmark-circle-outline" size={19} color={colors.accent} />
            <Text style={[styles.feedbackText, { color: colors.foreground }]}>{notice}</Text>
          </View>
        ) : null}

        <View style={styles.listHeading}>
          <View>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Your documents</Text>
            <Text style={[styles.description, { color: colors.mutedForeground }]}>
              Download, share, or remove files you have uploaded.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh documents"
            disabled={documentsQuery.isFetching}
            onPress={() => void documentsQuery.refetch()}
            style={({ pressed }) => [styles.iconButton, { opacity: pressed || documentsQuery.isFetching ? 0.6 : 1 }]}
          >
            {documentsQuery.isFetching
              ? <ActivityIndicator size="small" color={colors.accent} />
              : <Ionicons name="refresh-outline" size={20} color={colors.accent} />}
          </Pressable>
        </View>

        {documentsQuery.isLoading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colors.accent} />
            <Text style={[styles.stateText, { color: colors.mutedForeground }]}>Loading your documents…</Text>
          </View>
        ) : documentsQuery.isError ? (
          <View style={[styles.stateCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.stateText, { color: colors.foreground }]}>
              Your documents could not be loaded.
            </Text>
            <SecondaryButton
              label="Try again"
              icon="refresh-outline"
              colors={colors}
              onPress={() => void documentsQuery.refetch()}
            />
          </View>
        ) : documents.length === 0 ? (
          <View style={[styles.stateCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="documents-outline" size={28} color={colors.mutedForeground} />
            <Text style={[styles.stateText, { color: colors.foreground }]}>No documents uploaded yet.</Text>
            <Text style={[styles.description, { color: colors.mutedForeground }]}>
              Choose a document above to use it with your applications.
            </Text>
          </View>
        ) : (
          <View style={styles.documentList}>
            {documents.map((document) => (
              <View
                key={document.id}
                style={[styles.documentCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <View style={styles.documentTop}>
                  <View style={[styles.iconWrap, { backgroundColor: colors.muted }]}>
                    <Ionicons name="document-text-outline" size={19} color={colors.accent} />
                  </View>
                  <View style={styles.grow}>
                    <Text numberOfLines={2} style={[styles.fileName, { color: colors.foreground }]}>
                      {document.filename}
                    </Text>
                    <Text style={[styles.fileDetail, { color: colors.mutedForeground }]}>
                      {document.isPrimary ? "Primary CV" : (document.label || document.documentType || "Document")}
                      {" · "}{fileSizeLabel(document.fileSize)}
                    </Text>
                  </View>
                </View>

                <View style={styles.actions}>
                  <SecondaryButton
                    label={downloadingId === document.id ? "Preparing file…" : "Open or share"}
                    icon="download-outline"
                    disabled={downloadingId !== null || deletingId !== null}
                    colors={colors}
                    onPress={() => void downloadDocument(document.id, document.storageKey, document.filename)}
                  />
                  {Platform.OS === "ios" && document.mimeType === "application/pdf" ? (
                    <SecondaryButton
                      label={downloadingId === document.id ? "Preparing PDF…" : "View PDF"}
                      icon="eye-outline"
                      disabled={downloadingId !== null || deletingId !== null}
                      colors={colors}
                      onPress={() => void downloadDocument(document.id, document.storageKey, document.filename, true)}
                    />
                  ) : null}
                  {confirmDeleteId === document.id ? (
                    <View style={styles.confirmActions}>
                      <SecondaryButton
                        label={deletingId === document.id ? "Deleting…" : "Confirm delete"}
                        icon="trash-outline"
                        disabled={deletingId !== null}
                        colors={colors}
                        onPress={() => void removeDocument(document.id)}
                      />
                      <SecondaryButton
                        label="Keep document"
                        icon="close-outline"
                        disabled={deletingId !== null}
                        colors={colors}
                        onPress={() => setConfirmDeleteId(null)}
                      />
                    </View>
                  ) : (
                    <SecondaryButton
                      label="Delete"
                      icon="trash-outline"
                      disabled={deletingId !== null || downloadingId !== null}
                      colors={colors}
                      onPress={() => void removeDocument(document.id)}
                    />
                  )}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
      {Platform.OS === "ios" ? (
        <Modal
          animationType="slide"
          onRequestClose={closePdfViewer}
          presentationStyle="fullScreen"
          visible={pdfViewer !== null}
        >
          <SafeAreaView style={[styles.pdfViewer, { backgroundColor: colors.background }]}>
            <View style={[styles.pdfHeader, { borderBottomColor: colors.border }]}>
              <View style={styles.grow}>
                <Text accessibilityRole="header" numberOfLines={1} style={[styles.fileName, { color: colors.foreground }]}>
                  {pdfViewer?.filename ?? "PDF"}
                </Text>
                <Text style={[styles.fileDetail, { color: colors.mutedForeground }]}>Private document preview</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close PDF preview"
                onPress={closePdfViewer}
                style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Ionicons name="close" size={23} color={colors.foreground} />
              </Pressable>
            </View>
            {pdfViewerError ? (
              <View style={[styles.pdfError, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.stateText, { color: colors.foreground }]}>{pdfViewerError}</Text>
                <SecondaryButton
                  label="Close preview"
                  icon="share-outline"
                  colors={colors}
                  onPress={closePdfViewer}
                />
              </View>
            ) : pdfViewer ? (
              <WebView
                allowingReadAccessToURL={pdfViewer.uri}
                javaScriptEnabled={false}
                originWhitelist={["*"]}
                onError={() => setPdfViewerError("This PDF could not be displayed here. Close the preview and use Open or share instead.")}
                onShouldStartLoadWithRequest={(request) => (
                  request.url.split("#")[0] === pdfViewer.uri.split("#")[0]
                )}
                source={{ uri: pdfViewer.uri }}
                style={styles.pdfWebView}
              />
            ) : null}
          </SafeAreaView>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}

function PrimaryButton({
  label,
  icon,
  disabled = false,
  colors,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  disabled?: boolean;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        { backgroundColor: colors.primary, borderRadius: colors.radius, opacity: disabled || pressed ? 0.7 : 1 },
      ]}
    >
      <Ionicons name={icon} size={18} color={colors.primaryForeground} />
      <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({
  label,
  icon,
  disabled = false,
  colors,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  disabled?: boolean;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        {
          backgroundColor: colors.background,
          borderColor: colors.border,
          borderRadius: colors.radius,
          opacity: disabled || pressed ? 0.65 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={17} color={colors.accent} />
      <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { padding: 20, paddingBottom: 128, gap: 18 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4 },
  backButton: {
    width: 44, height: 44, borderWidth: 1, borderRadius: 22, alignItems: "center", justifyContent: "center",
  },
  headerCopy: { flex: 1, gap: 3 },
  title: { fontSize: 23, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular" },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 14 },
  sectionHeading: { flexDirection: "row", alignItems: "flex-start", gap: 11 },
  iconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  grow: { flex: 1, gap: 3 },
  cardTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  description: { fontSize: 12, lineHeight: 18, fontFamily: "Inter_400Regular" },
  selectedFile: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, padding: 12 },
  fileName: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_600SemiBold" },
  fileDetail: { fontSize: 12, fontFamily: "Inter_400Regular" },
  uploadingRow: { minHeight: 46, padding: 11, borderRadius: 11, gap: 10 },
  transferStatus: { minHeight: 24, flexDirection: "row", alignItems: "center", gap: 10 },
  progressTrack: { height: 7, borderRadius: 4, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 4 },
  uploadingText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  actions: { gap: 9 },
  primaryButton: { minHeight: 48, paddingHorizontal: 14, paddingVertical: 11, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8 },
  primaryButtonText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  secondaryButton: { minHeight: 44, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 10, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 7 },
  secondaryButtonText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  feedback: { minHeight: 48, borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 9 },
  feedbackText: { flex: 1, fontSize: 13, lineHeight: 19, fontFamily: "Inter_500Medium" },
  listHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  stateCard: { minHeight: 108, borderWidth: 1, borderRadius: 16, padding: 18, alignItems: "center", justifyContent: "center", gap: 10 },
  stateText: { textAlign: "center", fontSize: 14, lineHeight: 20, fontFamily: "Inter_500Medium" },
  documentList: { gap: 12 },
  documentCard: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 13 },
  documentTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  confirmActions: { gap: 8 },
  pdfViewer: { flex: 1 },
  pdfHeader: { minHeight: 64, borderBottomWidth: 1, paddingHorizontal: 16, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 12 },
  pdfWebView: { flex: 1, backgroundColor: "transparent" },
  pdfError: { flex: 1, padding: 20, justifyContent: "center", gap: 12 },
});
