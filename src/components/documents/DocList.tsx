import Icon from "@/components/ui/icon";
import { proxyImg } from "@/lib/api";
import type { DocWithRecognition } from "./docTypes";
import { isImage } from "./docTypes";

interface Props {
  docs: DocWithRecognition[];
  loading: boolean;
  selected: DocWithRecognition | null;
  dragging: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  onSelect: (doc: DocWithRecognition) => void;
  onDelete: (id: number) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onFilesChange: (files: File[]) => void;
  onAddManual: () => void;
}

export default function DocList({
  docs, loading, selected, dragging,
  inputRef, onSelect, onDelete,
  onDragOver, onDragLeave, onDrop, onFilesChange, onAddManual,
}: Props) {
  return (
    <div className="lg:col-span-2 card-fin flex flex-col">
      {/* Desktop drag zone */}
      <div className="p-4 border-b border-border hidden lg:block space-y-2">
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-all ${dragging ? "border-gold bg-gold/5" : "border-border hover:border-gold/40 hover:bg-secondary/50"}`}
        >
          <Icon name="Upload" size={24} className={`mx-auto mb-2 ${dragging ? "text-gold" : "text-muted-foreground"}`} />
          <div className="text-sm font-medium mb-1">Перетащите или нажмите</div>
          <div className="text-xs text-muted-foreground">PDF, JPG, PNG, XLS — можно несколько файлов сразу</div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.xls,.xlsx"
            className="hidden"
            onChange={(e) => e.target.files && onFilesChange(Array.from(e.target.files))}
          />
        </div>
        <button
          onClick={onAddManual}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-border text-muted-foreground text-xs hover:border-gold/40 hover:text-gold transition-colors"
        >
          <Icon name="FilePlus" size={14} />
          Добавить без фото
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading && Array(3).fill(0).map((_, i) => (
          <div key={i} className="p-3 flex gap-3 animate-pulse mb-1">
            <div className="w-9 h-9 bg-secondary rounded flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-4 bg-secondary rounded w-3/4" />
              <div className="h-3 bg-secondary rounded w-1/2" />
            </div>
          </div>
        ))}

        {!loading && docs.length === 0 && (
          <div className="py-10 text-center text-muted-foreground text-sm">
            <Icon name="ScanLine" size={28} className="mx-auto mb-2 opacity-40" />
            Загрузите документ — ИИ всё заполнит
          </div>
        )}

        {docs.map((doc, idx) => (
          <div
            key={doc.id}
            className={`flex items-center gap-2.5 sm:gap-3 p-2.5 sm:p-3 rounded-lg cursor-pointer transition-all mb-1 ${
              selected?.id === doc.id
                ? "bg-gold/10 border border-gold/30"
                : "hover:bg-secondary border border-transparent"
            }`}
          >
            <button
              onClick={() => onSelect(doc)}
              className="flex-1 flex items-center gap-2.5 sm:gap-3 text-left min-w-0"
            >
              <div className="relative w-9 h-9 rounded overflow-hidden flex items-center justify-center bg-secondary flex-shrink-0">
                <span className="absolute top-0 left-0 z-10 bg-black/60 text-white text-[9px] font-bold leading-none px-1 py-0.5 rounded-br">
                  {idx + 1}
                </span>
                {(doc.previewUrl || doc.s3_url) ? (
                  <img
                    src={doc.previewUrl || proxyImg(doc.s3_url)}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      const img = e.currentTarget;
                      img.style.display = "none";
                      const fallback = img.parentElement?.querySelector(".doc-thumb-fallback") as HTMLElement;
                      if (fallback) fallback.style.display = "flex";
                    }}
                  />
                ) : null}
                <span
                  className="doc-thumb-fallback w-full h-full items-center justify-center"
                  style={{ display: (doc.previewUrl || doc.s3_url) ? "none" : "flex" }}
                >
                  <Icon name={isImage(doc.name) ? "Image" : "FileText"} size={17} className="text-muted-foreground" />
                </span>
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-sm truncate">{doc.name}</div>
                {doc.status === "done" && (doc.rec_date || doc.rec_type || doc.rec_amount) ? (
                  <div className="text-[11px] sm:text-xs text-gold/80 leading-tight mt-0.5 flex flex-wrap gap-x-1">
                    {doc.rec_date && <span>{doc.rec_date}</span>}
                    {doc.rec_type && <span>· {doc.rec_type}</span>}
                    {doc.rec_amount && <span className="font-medium">· {doc.rec_amount}</span>}
                  </div>
                ) : (
                  <div className="text-[11px] sm:text-xs text-muted-foreground">{doc.size_label}</div>
                )}
              </div>
            </button>

            <div className="flex items-center gap-1 flex-shrink-0">
              {doc.recognizing && (
                <div className="w-3.5 h-3.5 rounded-full border-2 border-gold border-t-transparent animate-spin" />
              )}
              {!doc.recognizing && doc.status === "done" && (
                <Icon name="CheckCircle" size={15} className="text-positive" />
              )}
              {!doc.recognizing && doc.status === "error" && (
                <Icon name="AlertCircle" size={15} className="text-negative" />
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(doc.id); }}
                className="w-8 h-8 rounded flex items-center justify-center text-muted-foreground hover:text-negative hover:bg-red-900/10 transition-colors"
              >
                <Icon name="Trash2" size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}