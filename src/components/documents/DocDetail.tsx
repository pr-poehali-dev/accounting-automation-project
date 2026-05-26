import { useState, useEffect } from "react";
import Icon from "@/components/ui/icon";
import { proxyImg } from "@/lib/api";
import type { DocWithRecognition } from "./docTypes";
import { DEFAULT_CATEGORIES } from "./docTypes";

interface Props {
  selected: DocWithRecognition | null;
  mobileView: "list" | "detail";
  selDone: boolean;
  editingCategory: boolean;
  savingCategory: boolean;
  newCatInline: string;
  addingCatInline: boolean;
  customCategories: string[];
  reuploadRef: React.RefObject<HTMLInputElement>;
  onRecognizeAgain: () => void;
  onShare: () => void;
  onDownload: () => void;
  onReupload: (file: File) => void;
  onDelete: (id: number) => void;
  onOpenCreateTx: () => void;
  onFieldUpdate: (field: string, value: string) => void;
  onCategoryChange: (cat: string) => void;
  onSetEditingCategory: (v: boolean) => void;
  onSetAddingCatInline: (v: boolean) => void;
  onSetNewCatInline: (v: string) => void;
  onSaveCustomCategory: (name: string) => void;
  onSetCustomCategories: (cats: string[]) => void;
  onCashlessToggle: (id: number, value: boolean) => void;
}

function EditableField({ label, value, icon, onSave }: { label: string; value: string; icon: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  useEffect(() => setVal(value), [value]);
  const save = () => { setEditing(false); if (val !== value) onSave(val); };
  return (
    <div className="card-fin-raised p-3 flex items-center gap-3">
      <div className="w-8 h-8 rounded flex items-center justify-center bg-gold/10 flex-shrink-0">
        <Icon name={icon} size={14} className="text-gold" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        {editing ? (
          <input value={val} onChange={(e) => setVal(e.target.value)} onBlur={save}
            onKeyDown={(e) => e.key === "Enter" && save()} autoFocus
            className="w-full text-sm mt-0.5 bg-transparent border-b border-gold outline-none text-foreground" />
        ) : (
          <div className="text-sm font-medium mt-0.5 truncate">{val}</div>
        )}
      </div>
      <button onClick={() => setEditing(!editing)} className="text-muted-foreground hover:text-foreground transition-colors p-1">
        <Icon name={editing ? "Check" : "Pencil"} size={13} />
      </button>
    </div>
  );
}

export default function DocDetail({
  selected, mobileView, selDone,
  editingCategory, savingCategory, newCatInline, addingCatInline,
  customCategories, reuploadRef,
  onRecognizeAgain, onShare, onDownload, onReupload,
  onDelete, onOpenCreateTx, onFieldUpdate, onCategoryChange,
  onSetEditingCategory, onSetAddingCatInline, onSetNewCatInline,
  onSaveCustomCategory, onSetCustomCategories, onCashlessToggle,
}: Props) {
  const loadCustomCats = () => {
    try { return JSON.parse(localStorage.getItem("custom_categories_v1") || "[]"); } catch { return []; }
  };

  return (
    <div className={`lg:col-span-3 card-fin p-3 sm:p-5 flex flex-col min-h-64 ${mobileView === "list" ? "hidden lg:flex" : "flex"}`}>
      {selected ? (
        <>
          {/* Header */}
          <div className="flex items-start justify-between mb-4 gap-2 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] sm:text-xs uppercase tracking-widest text-muted-foreground mb-1">ИИ-распознавание</div>
              <div className="text-sm font-medium truncate">{selected.name}</div>
            </div>
            <div className="flex-shrink-0 flex items-center gap-2">
              {selected.recognizing && (
                <span className="flex items-center gap-1.5 text-xs text-gold bg-gold/10 px-2.5 py-1 rounded-full whitespace-nowrap">
                  <div className="w-2.5 h-2.5 rounded-full border-2 border-gold border-t-transparent animate-spin" />
                  ИИ читает...
                </span>
              )}
              {!selected.recognizing && selected.status === "done" && (
                <span className="flex items-center gap-1.5 text-xs text-positive bg-green-900/20 px-2.5 py-1 rounded-full whitespace-nowrap">
                  <Icon name="Sparkles" size={12} /> Распознано
                </span>
              )}
              {!selected.recognizing && selected.status === "error" && (
                <span className="flex items-center gap-1.5 text-xs text-negative bg-red-900/20 px-2.5 py-1 rounded-full whitespace-nowrap">
                  <Icon name="AlertCircle" size={12} /> Ошибка
                </span>
              )}
              {!selected.recognizing && (selected.previewUrl || selected.s3_url) && (
                <button onClick={onRecognizeAgain}
                  title="Распознать заново"
                  className="flex items-center gap-1.5 text-xs text-gold bg-gold/10 hover:bg-gold/20 px-2.5 py-1 rounded-full whitespace-nowrap transition-colors active:scale-95">
                  <Icon name="RefreshCw" size={12} />
                  <span className="hidden sm:inline">Прочитать повторно</span>
                </button>
              )}
            </div>
          </div>

          {/* Quick actions */}
          {(selected.previewUrl || selected.s3_url) && (
            <div className="flex gap-2 mb-3 flex-wrap">
              <button onClick={onShare}
                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-border text-foreground hover:border-gold/40 hover:bg-gold/5 transition-colors active:scale-95">
                <Icon name="Share2" size={14} className="text-gold" />
                Поделиться
              </button>
              <button onClick={onDownload}
                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-border text-foreground hover:border-gold/40 hover:bg-gold/5 transition-colors active:scale-95">
                <Icon name="Download" size={14} className="text-gold" />
                Скачать
              </button>
              {selected.s3_url && (
                <a href={selected.s3_url} target="_blank" rel="noopener noreferrer"
                  className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-border text-foreground hover:border-gold/40 hover:bg-gold/5 transition-colors active:scale-95">
                  <Icon name="ExternalLink" size={14} className="text-gold" />
                  Открыть
                </a>
              )}
            </div>
          )}

          {/* Preview */}
          {(selected.previewUrl || selected.s3_url) ? (
            <div className="mb-3">
              <div className="rounded-lg overflow-hidden border border-border bg-secondary/30">
                <img
                  src={selected.previewUrl || proxyImg(selected.s3_url)}
                  alt="Документ"
                  className="w-full max-h-52 object-contain"
                />
              </div>
              <div className="mt-1 px-0.5">
                {selected.s3_url?.includes("yandexcloud.net") ? (
                  <span className="text-[11px] text-muted-foreground">🟡 Яндекс</span>
                ) : selected.s3_url?.includes("cdn.poehali.dev") || selected.s3_url?.includes("bucket.poehali.dev") ? (
                  <span className="text-[11px] text-muted-foreground">🟢 CDN</span>
                ) : selected.s3_url ? (
                  <span className="text-[11px] text-muted-foreground">🟢 CDN</span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">🔴 фото не загружено в хранилище</span>
                )}
              </div>
            </div>
          ) : (
            <div className="mb-3">
              <button onClick={() => reuploadRef.current?.click()}
                className="w-full py-3 flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border hover:border-gold/50 hover:bg-gold/5 text-sm text-muted-foreground hover:text-foreground transition-colors active:scale-95">
                <Icon name="ImagePlus" size={16} className="text-gold" />
                Прикрепить фото документа
              </button>
              <input ref={reuploadRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { if (e.target.files?.[0]) { onReupload(e.target.files[0]); (e.target as HTMLInputElement).value = ""; } }} />
              <div className="mt-1 px-0.5">
                <span className="text-[11px] text-muted-foreground">🔴 фото не загружено в хранилище</span>
              </div>
            </div>
          )}

          {/* Галочка безнал — для уже существующих документов без recognition */}
          {!selected.recognizing && selected.status === "done" && !selDone && (
            <div className="mb-3">
              <button
                onClick={() => onCashlessToggle(selected.id, !selected.is_cashless)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all active:scale-95 ${
                  selected.is_cashless
                    ? "border-blue-500/50 bg-blue-500/10"
                    : "border-border bg-transparent hover:border-blue-500/30 hover:bg-blue-500/5"
                }`}
              >
                <div className={`w-5 h-5 rounded flex items-center justify-center border-2 flex-shrink-0 transition-colors ${
                  selected.is_cashless ? "bg-blue-500 border-blue-500" : "border-muted-foreground"
                }`}>
                  {selected.is_cashless && <Icon name="Check" size={12} className="text-white" />}
                </div>
                <div className="text-left">
                  <div className={`text-sm font-medium ${selected.is_cashless ? "text-blue-400" : "text-foreground"}`}>
                    Безналичный расчёт
                  </div>
                  <div className="text-xs text-muted-foreground">Учитывается в отчёте по безналу</div>
                </div>
              </button>
              <div className="flex gap-2 pt-3">
                <button onClick={() => onDelete(selected.id)}
                  className="px-4 py-2.5 border border-red-900/40 text-negative rounded text-sm hover:bg-red-900/20 transition-colors">
                  <Icon name="Trash2" size={15} />
                </button>
              </div>
            </div>
          )}

          {/* Recognizing spinner */}
          {selected.recognizing && (
            <div className="flex flex-col items-center justify-center gap-3 py-6">
              <div className="relative">
                <div className="w-14 h-14 rounded-full border-4 border-border border-t-gold animate-spin" />
                <Icon name="Sparkles" size={18} className="text-gold absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </div>
              <div className="text-sm font-medium">ИИ анализирует документ</div>
              <div className="text-xs text-muted-foreground text-center max-w-xs">Извлекаю сумму, дату, контрагента и категорию...</div>
            </div>
          )}

          {/* Error */}
          {!selected.recognizing && selected.status === "error" && (
            <div className="flex flex-col items-center justify-center gap-3 py-6">
              <Icon name="AlertCircle" size={32} className="text-negative" />
              <div className="text-sm text-negative text-center">{selected.recognitionError || "Не удалось распознать документ"}</div>
              <div className="text-xs text-muted-foreground text-center">Убедитесь что добавлен API ключ в Настройках</div>
            </div>
          )}

          {/* Done state */}
          {selDone && (
            <div className="space-y-2.5">
              {selected.recognition?.transaction_id && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-green-900/20 border border-green-900/30 animate-fade-in">
                  <Icon name="CheckCircle" size={16} className="text-positive flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-positive">Операция создана автоматически</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {selected.recognition.category} • {selected.recognition.amount_str || ""}
                      {!selected.recognition.date_found && " • Дата не найдена — поставлена сегодня"}
                    </div>
                  </div>
                </div>
              )}

              {selected.recognition && !selected.recognition.transaction_id && !selected.recognition.amount && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-yellow-900/20 border border-yellow-900/30 animate-fade-in">
                  <Icon name="AlertTriangle" size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-yellow-400">Сумма не найдена — операция не создана</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Создайте операцию вручную ниже</div>
                  </div>
                </div>
              )}

              {/* Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {selected.recognition?.doc_type && (
                  <EditableField label="Тип документа" value={selected.recognition.doc_type} icon="FileText"
                    onSave={(v) => onFieldUpdate("rec_type", v)} />
                )}
                {(selected.recognition?.amount_str || selected.rec_amount) && (
                  <EditableField label="Сумма" value={selected.recognition?.amount_str || selected.rec_amount || ""} icon="Banknote"
                    onSave={(v) => onFieldUpdate("rec_amount", v)} />
                )}
                {(selected.recognition?.date || selected.rec_date) && (
                  <EditableField label="Дата" value={selected.recognition?.date || selected.rec_date || ""} icon="Calendar"
                    onSave={(v) => onFieldUpdate("rec_date", v)} />
                )}
                {(selected.recognition?.counterparty || selected.rec_counterparty) && (
                  <EditableField label="Контрагент" value={selected.recognition?.counterparty || selected.rec_counterparty || ""} icon="Building2"
                    onSave={(v) => onFieldUpdate("rec_counterparty", v)} />
                )}
                {(selected.recognition?.inn || selected.rec_inn) && (
                  <EditableField label="ИНН" value={selected.recognition?.inn || selected.rec_inn || ""} icon="Hash"
                    onSave={(v) => onFieldUpdate("rec_inn", v)} />
                )}
              </div>

              {/* Category */}
              {(selected.transaction_id || selected.recognition?.transaction_id) && (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Статья затрат</div>
                  {editingCategory ? (
                    <div className="space-y-2">
                      {addingCatInline ? (
                        <div className="flex gap-1.5">
                          <input
                            autoFocus
                            value={newCatInline}
                            onChange={(e) => onSetNewCatInline(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === "Enter" && newCatInline.trim()) {
                                const name = newCatInline.trim();
                                onSaveCustomCategory(name);
                                onSetCustomCategories(loadCustomCats());
                                await onCategoryChange(name);
                                onSetNewCatInline("");
                                onSetAddingCatInline(false);
                              }
                              if (e.key === "Escape") { onSetAddingCatInline(false); onSetNewCatInline(""); }
                            }}
                            placeholder="Название новой статьи..."
                            className="flex-1 min-w-0 bg-secondary border border-gold rounded px-2.5 py-1.5 text-sm text-foreground focus:outline-none"
                          />
                          <button
                            disabled={!newCatInline.trim() || savingCategory}
                            onClick={async () => {
                              const name = newCatInline.trim();
                              if (!name) return;
                              onSaveCustomCategory(name);
                              onSetCustomCategories(loadCustomCats());
                              await onCategoryChange(name);
                              onSetNewCatInline("");
                              onSetAddingCatInline(false);
                            }}
                            className="px-2.5 py-1.5 bg-gold text-primary-foreground rounded text-sm disabled:opacity-50"
                          >
                            <Icon name="Check" size={14} />
                          </button>
                          <button onClick={() => { onSetAddingCatInline(false); onSetNewCatInline(""); }}
                            className="px-2.5 py-1.5 border border-border rounded text-sm text-muted-foreground hover:text-foreground">
                            <Icon name="X" size={14} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-1.5">
                          <select
                            value={selected.rec_category || selected.recognition?.category || ""}
                            disabled={savingCategory}
                            onChange={(e) => {
                              if (e.target.value === "__new__") {
                                onSetAddingCatInline(true);
                              } else {
                                onCategoryChange(e.target.value);
                              }
                            }}
                            className="flex-1 min-w-0 bg-secondary border border-gold rounded px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold"
                          >
                            {[...DEFAULT_CATEGORIES, ...customCategories].map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                            <option value="__new__">+ Создать свою...</option>
                          </select>
                          {savingCategory
                            ? <Icon name="Loader" size={16} className="animate-spin text-gold flex-shrink-0 self-center" />
                            : <button onClick={() => { onSetEditingCategory(false); onSetAddingCatInline(false); }}
                                className="px-2.5 py-1.5 border border-border rounded text-sm text-muted-foreground hover:text-foreground flex-shrink-0">
                                <Icon name="X" size={14} />
                              </button>
                          }
                        </div>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => { onSetEditingCategory(true); onSetAddingCatInline(false); }}
                      className="flex items-center gap-1.5 text-sm bg-gold/15 hover:bg-gold/25 text-gold px-3 py-1.5 rounded-lg font-medium transition-colors w-full justify-between group"
                    >
                      <span>{selected.rec_category || selected.recognition?.category || "Не указана"}</span>
                      <Icon name="ChevronDown" size={14} className="opacity-60 group-hover:opacity-100 flex-shrink-0" />
                    </button>
                  )}
                </div>
              )}

              {/* Безналичный расчёт */}
              <button
                onClick={() => onCashlessToggle(selected.id, !selected.is_cashless)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all active:scale-95 ${
                  selected.is_cashless
                    ? "border-blue-500/50 bg-blue-500/10"
                    : "border-border bg-transparent hover:border-blue-500/30 hover:bg-blue-500/5"
                }`}
              >
                <div className={`w-5 h-5 rounded flex items-center justify-center border-2 flex-shrink-0 transition-colors ${
                  selected.is_cashless ? "bg-blue-500 border-blue-500" : "border-muted-foreground"
                }`}>
                  {selected.is_cashless && <Icon name="Check" size={12} className="text-white" />}
                </div>
                <div className="text-left">
                  <div className={`text-sm font-medium ${selected.is_cashless ? "text-blue-400" : "text-foreground"}`}>
                    Безналичный расчёт
                  </div>
                  <div className="text-xs text-muted-foreground">Учитывается в отчёте по безналу</div>
                </div>
              </button>

              {selected.recognition?.description && (
                <div className="card-fin-raised p-3 rounded-lg">
                  <div className="text-xs text-muted-foreground mb-1">Описание</div>
                  <div className="text-sm leading-relaxed">{selected.recognition.description}</div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                {!(selected.transaction_id || selected.recognition?.transaction_id) && (
                  <button onClick={onOpenCreateTx}
                    className="flex-1 py-3 sm:py-2.5 bg-gold text-primary-foreground rounded text-sm font-medium hover:bg-yellow-500 transition-colors active:scale-95 flex items-center justify-center gap-2">
                    <Icon name="Plus" size={15} />
                    <span className="hidden sm:inline">Создать операцию вручную</span>
                    <span className="sm:hidden">Создать операцию</span>
                  </button>
                )}
                {(selected.transaction_id || selected.recognition?.transaction_id) && (
                  <button onClick={onOpenCreateTx}
                    className="flex-1 py-3 sm:py-2.5 border border-border text-muted-foreground rounded text-sm hover:text-foreground hover:border-gold/40 transition-colors flex items-center justify-center gap-2">
                    <Icon name="Pencil" size={14} />
                    Исправить операцию
                  </button>
                )}
                <button onClick={() => onDelete(selected.id)}
                  className="px-4 py-3 sm:py-2.5 border border-red-900/40 text-negative rounded text-sm hover:bg-red-900/20 transition-colors flex-shrink-0">
                  <Icon name="Trash2" size={15} />
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 py-8">
          <Icon name="ScanLine" size={36} className="opacity-40" />
          <div className="text-sm">Загрузите или сфотографируйте документ</div>
          <div className="text-xs text-center max-w-xs">ИИ автоматически извлечёт сумму, дату и контрагента</div>
        </div>
      )}
    </div>
  );
}