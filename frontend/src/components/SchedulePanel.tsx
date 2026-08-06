import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import ScheduleForm from "@/components/ScheduleForm";
import ScheduleList from "@/components/ScheduleList";
import type { Provider, Schedule } from "@/types";

interface Props {
  providers: Provider[];
}

export default function SchedulePanel({ providers }: Props) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleNew = useCallback(() => {
    setEditing(null);
    setFormOpen(true);
  }, []);

  const handleEdit = useCallback((schedule: Schedule) => {
    setEditing(schedule);
    setFormOpen(true);
  }, []);

  const handleSaved = useCallback(() => {
    setFormOpen(false);
    setEditing(null);
    setRefreshKey((k) => k + 1);
  }, []);

  const handleCancel = useCallback(() => {
    setFormOpen(false);
    setEditing(null);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium flex items-center gap-2">
          定期测速任务
        </span>
        <Button size="sm" onClick={handleNew}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          新建
        </Button>
      </div>

      {formOpen && (
        <ScheduleForm
          providers={providers}
          editing={editing}
          onSaved={handleSaved}
          onCancel={handleCancel}
        />
      )}

      <ScheduleList refreshKey={refreshKey} onEdit={handleEdit} />
    </div>
  );
}
