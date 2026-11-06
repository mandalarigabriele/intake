import { useDeleteMeal } from "../api/queries";
import { t } from "../lib/strings";
import { Scrim } from "./Scrim";

interface Props {
  mealId: string;
  mealType: string;
  onClose: () => void;
  onDeleted: () => void;
}

/** Bottom-sheet confirmation before deleting a meal from Nutrition. */
export function ConfirmDeleteSheet({ mealId, mealType, onClose, onDeleted }: Props) {
  const remove = useDeleteMeal();
  const title = t.edit.deleteConfirmTitle(mealType);
  return (
    <Scrim onClose={onClose}>
      <div className="sheet confirm-sheet" role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p>{t.edit.deleteBody}</p>
        {remove.isError && <p className="error-text">{t.edit.deleteFailed}</p>}
        <button type="button" className="button-danger-solid" disabled={remove.isPending} onClick={() => remove.mutate(mealId, { onSuccess: onDeleted })}>
          {t.edit.deleteConfirm}
        </button>
        <button type="button" className="button-neutral" onClick={onClose}>
          {t.edit.cancel}
        </button>
      </div>
    </Scrim>
  );
}
