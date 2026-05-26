import { useState } from "react";
import Icon from "@/components/ui/icon";
import { proxyImg } from "@/lib/api";
import type { DocWithRecognition, PageItem } from "./docTypes";
import { DEFAULT_CATEGORIES } from "./docTypes";

// ── Merge dialog ────────────────────────────────────────────
interface MergeDialogProps {
  mergeDialog: { images: File[]; nonImages: File[] } | null;
  onClose: () => void;
  onMultiPage: (images: File[], nonImages: File[]) => void;
  onSeparate: (all: File[]) => void;
}

export function MergeDialog({ mergeDialog, onClose, onMultiPage, onSeparate }: MergeDialogProps) {
  if (!mergeDialog) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-sm p-5 space-y-4 animate-fade-in">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-gold/10 flex items-center justify-center mx-auto mb-3">
            <Icon name="Images" size={22} className="text-gold" />
          </div>
          <div className="font-semibold text-base">Выбрано {mergeDialog.images.length} фото</div>
          <div className="text-sm text-muted-foreground mt-1">Это разные страницы одного документа или отдельные документы?</div>
        </div>
        <button
          onClick={() => onMultiPage(mergeDialog.images, mergeDialog.nonImages)}
          className="w-full py-3 bg-gold text-black font-semibold rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform">
          <Icon name="BookOpen" size={18} />
          Один документ (страницы)
        </button>
        <button
          onClick={() => onSeparate([...mergeDialog.images, ...mergeDialog.nonImages])}
          className="w-full py-3 border border-border rounded-xl text-sm text-foreground flex items-center justify-center gap-2 active:scale-95 transition-transform hover:border-gold/40">
          <Icon name="Files" size={18} />
          Отдельные документы
        </button>
        <button onClick={onClose} className="w-full text-sm text-muted-foreground py-1">Отмена</button>
      </div>
    </div>
  );
}

// ── Delete confirm dialog ────────────────────────────────────
interface DeleteDialogProps {
  deleteConfirmId: number | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteDialog({ deleteConfirmId, onConfirm, onCancel }: DeleteDialogProps) {
  if (deleteConfirmId === null) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-sm p-5 space-y-4 animate-fade-in">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-red-900/20 flex items-center justify-center mx-auto mb-3">
            <Icon name="Trash2" size={22} className="text-negative" />
          </div>
          <div className="font-semibold text-base">Удалить документ?</div>
          <div className="text-sm text-muted-foreground mt-1">Это действие нельзя отменить</div>
        </div>
        <button onClick={onConfirm}
          className="w-full py-3 bg-red-600 text-white font-semibold rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform">
          <Icon name="Trash2" size={16} />
          Удалить
        </button>
        <button onClick={onCancel} className="w-full py-2 text-sm text-muted-foreground">Отмена</button>
      </div>
    </div>
  );
}

// ── Create / Edit transaction modal ─────────────────────────
interface TxModalProps {
  show: boolean;
  selected: DocWithRecognition | null;
  txForm: { description: string; amount: string; date: string; category: string };
  txSaving: boolean;
  txSaved: boolean;
  customCategories: string[];
  showNewCat: boolean;
  newCatInput: string;
  onClose: () => void;
  onSave: () => void;
  onFormChange: (patch: Partial<{ description: string; amount: string; date: string; category: string }>) => void;
  onShowNewCat: (v: boolean) => void;
  onNewCatInput: (v: string) => void;
  onSaveCustomCategory: (name: string) => void;
  onSetCustomCategories: (cats: string[]) => void;
}

export function TxModal({
  show, selected, txForm, txSaving, txSaved,
  customCategories, showNewCat, newCatInput,
  onClose, onSave, onFormChange, onShowNewCat, onNewCatInput,
  onSaveCustomCategory, onSetCustomCategories,
}: TxModalProps) {
  if (!show) return null;
  const loadCats = () => { try { return JSON.parse(localStorage.getItem("custom_categories_v1") || "[]"); } catch { return []; } };
  const isExisting = !!(selected?.transaction_id || selected?.recognition?.transaction_id);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-md card-fin rounded-t-2xl sm:rounded-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">{isExisting ? "Исправить операцию" : "Создать операцию-расход"}</h2>
            <div className="text-xs text-muted-foreground mt-0.5">{isExisting ? "Изменения сохранятся в существующей операции" : "Данные заполнены ИИ, можно исправить"}</div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><Icon name="X" size={18} /></button>
        </div>

        {(selected?.previewUrl || selected?.s3_url) && (
          <div className="rounded-lg overflow-hidden border border-border bg-secondary/30">
            <div className="text-xs text-muted-foreground px-2 py-1 border-b border-border">Документ</div>
            <img src={selected.previewUrl || proxyImg(selected.s3_url)} alt="Документ" className="w-full max-h-40 object-contain" />
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Описание</label>
            <input value={txForm.description} onChange={(e) => onFormChange({ description: e.target.value })}
              className="w-full bg-secondary border border-border rounded px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Сумма (₽)</label>
              <input type="number" value={txForm.amount} onChange={(e) => onFormChange({ amount: e.target.value })}
                className="w-full bg-secondary border border-border rounded px-3 py-2.5 text-sm font-mono-fin text-foreground focus:outline-none focus:ring-1 focus:ring-gold" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Дата</label>
              <input type="date" value={txForm.date} onChange={(e) => onFormChange({ date: e.target.value })}
                className="w-full bg-secondary border border-border rounded px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Категория расхода</label>
            {showNewCat ? (
              <div className="flex gap-1">
                <input
                  autoFocus
                  value={newCatInput}
                  onChange={(e) => onNewCatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newCatInput.trim()) {
                      const name = newCatInput.trim();
                      onSaveCustomCategory(name);
                      onSetCustomCategories(loadCats());
                      onFormChange({ category: name });
                      onNewCatInput(""); onShowNewCat(false);
                    }
                    if (e.key === "Escape") { onShowNewCat(false); onNewCatInput(""); }
                  }}
                  placeholder="Название категории..."
                  className="flex-1 min-w-0 bg-secondary border border-gold rounded px-2 py-2 text-sm text-foreground focus:outline-none"
                />
                <button type="button" onClick={() => {
                  if (newCatInput.trim()) {
                    const name = newCatInput.trim();
                    onSaveCustomCategory(name);
                    onSetCustomCategories(loadCats());
                    onFormChange({ category: name });
                    onNewCatInput(""); onShowNewCat(false);
                  }
                }} className="px-2 py-2 bg-gold text-primary-foreground rounded text-sm">
                  <Icon name="Check" size={14} />
                </button>
              </div>
            ) : (
              <select value={txForm.category} onChange={(e) => {
                if (e.target.value === "__new__") { onShowNewCat(true); }
                else onFormChange({ category: e.target.value });
              }} className="w-full bg-secondary border border-border rounded px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold">
                {[...DEFAULT_CATEGORIES, ...customCategories].map((c) => <option key={c}>{c}</option>)}
                <option value="__new__">+ Своя категория...</option>
              </select>
            )}
          </div>
        </div>
        <div className="bg-secondary/60 rounded-lg p-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Icon name="TrendingDown" size={13} className="text-negative flex-shrink-0" />
          Тип: <strong className="text-negative ml-1">Расход</strong>
        </div>
        <button onClick={onSave} disabled={txSaving || txSaved || !txForm.amount || !txForm.description}
          className={`w-full py-2.5 rounded text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50 ${txSaved ? "bg-positive text-white" : "bg-gold text-primary-foreground hover:bg-yellow-500"}`}>
          {txSaving
            ? <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
            : txSaved
              ? <><Icon name="CheckCircle" size={15} />Операция создана!</>
              : <><Icon name="Plus" size={15} />Создать расход</>}
        </button>
      </div>
    </div>
  );
}

// ── Multi-page modal ─────────────────────────────────────────
interface MultiModalProps {
  show: boolean;
  pages: PageItem[];
  multiProcessing: boolean;
  uploadProgress: string;
  multiCameraRef: React.RefObject<HTMLInputElement>;
  onClose: () => void;
  onRemovePage: (idx: number) => void;
  onDone: () => void;
}

export function MultiModal({
  show, pages, multiProcessing, uploadProgress,
  multiCameraRef, onClose, onRemovePage, onDone,
}: MultiModalProps) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex flex-col"
      onClick={(e) => { if (e.target === e.currentTarget && pages.length === 0) onClose(); }}>
      <div className="flex items-center justify-between px-4 pt-5 pb-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Сфотографировать накладную</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Добавьте все страницы, затем нажмите «Готово»</p>
        </div>
        <button onClick={onClose}
          className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground">
          <Icon name="X" size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-3">
        {pages.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {pages.map((p, i) => (
              <div key={i} className="relative aspect-[3/4] rounded-xl overflow-hidden border border-border bg-secondary">
                <img src={p.previewUrl} alt={`Стр. ${i + 1}`} className="w-full h-full object-cover" />
                <button onClick={() => onRemovePage(i)}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-red-600 transition-colors">
                  <Icon name="X" size={12} />
                </button>
                <span className="absolute bottom-1 left-1 text-[10px] text-white bg-black/50 rounded px-1">{i + 1}</span>
              </div>
            ))}
            <button onClick={() => multiCameraRef.current?.click()}
              className="aspect-[3/4] rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-gold/50 hover:text-gold transition-colors">
              <Icon name="Plus" size={24} />
              <span className="text-xs">Ещё страница</span>
            </button>
          </div>
        )}
      </div>

      <div className="px-4 pt-2 space-y-2 border-t border-border bg-card"
        style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))" }}>
        {pages.length === 0 ? (
          <button onClick={() => multiCameraRef.current?.click()}
            className="w-full py-4 bg-gold text-primary-foreground rounded-xl text-base font-semibold flex items-center justify-center gap-3 active:scale-95 transition-transform">
            <Icon name="Camera" size={22} />
            Сфотографировать страницу
          </button>
        ) : (
          <>
            <button onClick={() => multiCameraRef.current?.click()}
              className="w-full py-3 border border-border text-muted-foreground rounded-xl text-sm font-medium flex items-center justify-center gap-2 hover:border-gold/40 hover:text-foreground transition-colors">
              <Icon name="Plus" size={16} />
              Добавить ещё страницу
            </button>
            <button onClick={onDone} disabled={multiProcessing}
              className="w-full py-4 bg-gold text-primary-foreground rounded-xl text-base font-semibold flex items-center justify-center gap-3 disabled:opacity-60 active:scale-95 transition-transform">
              {multiProcessing
                ? <><div className="w-5 h-5 rounded-full border-2 border-primary-foreground border-t-transparent animate-spin" /> {uploadProgress || "Обрабатываю..."}</>
                : <><Icon name="CheckCircle" size={22} /> Готово — {pages.length} {pages.length === 1 ? "страница" : pages.length < 5 ? "страницы" : "страниц"}</>}
            </button>
          </>
        )}
        <p className="text-center text-xs text-muted-foreground">
          {pages.length > 0 ? `${pages.length} стр. добавлено • ИИ обработает все сразу` : "Камера откроется автоматически"}
        </p>
      </div>
    </div>
  );
}

// ── Manual document modal ────────────────────────────────────
export interface ManualDocForm {
  name: string;
  amount: string;
  date: string;
  category: string;
  description: string;
  is_cashless: boolean;
}

interface ManualDocModalProps {
  show: boolean;
  saving: boolean;
  customCategories: string[];
  onClose: () => void;
  onSave: (form: ManualDocForm) => void;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

export function ManualDocModal({ show, saving, customCategories, onClose, onSave }: ManualDocModalProps) {
  const [form, setForm] = useState<ManualDocForm>({
    name: "", amount: "", date: todayStr(), category: "Прочее", description: "", is_cashless: false,
  });

  if (!show) return null;

  const allCats = [...DEFAULT_CATEGORIES, ...customCategories.filter((c) => !DEFAULT_CATEGORIES.includes(c))];

  const handleSave = () => {
    if (!form.amount || !form.date) return;
    onSave(form);
    setForm({ name: "", amount: "", date: todayStr(), category: "Прочее", description: "", is_cashless: false });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-sm animate-fade-in overflow-y-auto max-h-[90vh]">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gold/10 flex items-center justify-center">
              <Icon name="FilePlus" size={20} className="text-gold" />
            </div>
            <div>
              <div className="font-semibold text-base">Добавить без фото</div>
              <div className="text-xs text-muted-foreground">Ручной ввод расхода</div>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
            <Icon name="X" size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Название документа</label>
            <input
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="Чек, накладная, счёт..."
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Сумма ₽ <span className="text-negative">*</span></label>
              <input
                type="number"
                value={form.amount}
                onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
                placeholder="0.00"
                className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Дата <span className="text-negative">*</span></label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
                className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Статья затрат</label>
            <select
              value={form.category}
              onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold"
            >
              {allCats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Описание</label>
            <input
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Необязательно..."
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold"
            />
          </div>

          <button
            type="button"
            onClick={() => setForm((p) => ({ ...p, is_cashless: !p.is_cashless }))}
            className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${
              form.is_cashless ? "border-blue-500/50 bg-blue-500/10" : "border-border hover:border-blue-500/30"
            }`}
          >
            <div className={`w-5 h-5 rounded flex items-center justify-center border-2 flex-shrink-0 transition-colors ${
              form.is_cashless ? "bg-blue-500 border-blue-500" : "border-muted-foreground"
            }`}>
              {form.is_cashless && <Icon name="Check" size={12} className="text-white" />}
            </div>
            <span className={`text-sm font-medium ${form.is_cashless ? "text-blue-400" : "text-foreground"}`}>
              Безналичный расчёт
            </span>
          </button>
        </div>

        <div className="px-5 pb-5 space-y-2">
          <button
            onClick={handleSave}
            disabled={saving || !form.amount || !form.date}
            className="w-full py-3 bg-gold text-primary-foreground rounded-xl font-semibold text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving
              ? <><div className="w-4 h-4 rounded-full border-2 border-primary-foreground/50 border-t-primary-foreground animate-spin" /> Сохраняю...</>
              : <><Icon name="Plus" size={16} /> Добавить запись</>}
          </button>
          <button onClick={onClose} className="w-full py-2 text-sm text-muted-foreground">Отмена</button>
        </div>
      </div>
    </div>
  );
}