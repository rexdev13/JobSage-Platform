import { useRef } from "react";
import { useListMyDocuments, useDeleteDocument } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListMyDocumentsQueryKey } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, PageTransition } from "@/components/ui-enhanced";
import { useDocumentUpload } from "@/hooks/use-document-upload";
import { FileUp, File, Trash2, ShieldAlert, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

export default function DocumentsPage() {
  const { data } = useListMyDocuments();
  const deleteMutation = useDeleteDocument();
  const { uploadFile, isUploading, progress } = useDocumentUpload();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const success = await uploadFile(file);
    if (success) {
      toast({ title: "Upload complete", description: `${file.name} was successfully uploaded.` });
    } else {
      toast({ title: "Upload failed", variant: "destructive", description: "There was a problem uploading your file." });
    }
    
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this document?")) return;
    try {
      await deleteMutation.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListMyDocumentsQueryKey() });
      toast({ title: "Document deleted" });
    } catch (err) {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  };

  return (
    <AppLayout>
      <PageTransition>
        <header className="mb-8 flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground flex items-center">
              <FileText className="w-8 h-8 mr-3 text-primary" />
              My Documents
            </h1>
            <p className="text-muted-foreground mt-2">Upload reference documents for your own planning.</p>
          </div>
          <div>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileSelect} 
              className="hidden" 
              accept=".pdf,.jpg,.jpeg,.png"
            />
            <Button 
              onClick={() => fileInputRef.current?.click()} 
              disabled={isUploading}
            >
              <FileUp className="w-4 h-4 mr-2" />
              {isUploading ? `Uploading ${progress}%` : "Upload Document"}
            </Button>
          </div>
        </header>

        <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl flex items-start mb-8 shadow-sm">
          <ShieldAlert className="w-5 h-5 mr-3 shrink-0 mt-0.5 text-amber-600" />
          <div className="text-sm">
            <p className="font-semibold mb-1">Important Disclaimer</p>
            <p>Documents uploaded here are for your personal reference only. They are <strong>not verified</strong> by JOBSAGE, employers, or any regulatory body. You will still need to submit verified documents directly to regulators during official applications.</p>
          </div>
        </div>

        {isUploading && (
          <Card className="p-6 mb-6 flex flex-col items-center justify-center py-10">
            <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin mb-4" />
            <p className="text-primary font-medium">Uploading your document... {progress}%</p>
            <div className="w-full max-w-md h-2 bg-muted rounded-full mt-4 overflow-hidden">
              <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </Card>
        )}

        {(!data?.documents || data.documents.length === 0) && !isUploading ? (
          <Card className="p-12 text-center border-dashed border-2">
            <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mx-auto mb-4">
              <File className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No documents yet</h3>
            <p className="text-muted-foreground mb-6 max-w-sm mx-auto">Upload certificates, CVs, or identification for easy reference when planning your pathway.</p>
            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
              Browse Files
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {data?.documents.map((doc) => (
              <Card key={doc.id} className="p-5 flex flex-col group hover:shadow-md transition-all">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 -mr-2 -mt-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => handleDelete(doc.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
                <h4 className="font-semibold text-foreground truncate mb-1" title={doc.filename}>{doc.filename}</h4>
                <div className="flex justify-between items-center text-xs text-muted-foreground mt-auto pt-4 border-t border-border">
                  <span>{doc.fileSize ? `${Math.round(doc.fileSize / 1024)} KB` : 'Unknown size'}</span>
                  <span>{format(new Date(doc.uploadedAt), 'MMM d, yyyy')}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </PageTransition>
    </AppLayout>
  );
}
