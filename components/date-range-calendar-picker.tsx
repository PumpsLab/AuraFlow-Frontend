"use client";

import { Calendar, ArrowRight } from "lucide-react";

function parseIso(iso: string) {
  if (!iso) return null;
  const parts = iso.split("-").map(Number);
  if (parts.length !== 3) return null;
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

function formatDate(iso: string | null, placeholder: string) {
  if (!iso) return placeholder;
  const d = parseIso(iso);
  if (!d) return placeholder;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

interface DateRangeCalendarPickerProps {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  onStartChange: (iso: string) => void;
  onEndChange: (iso: string) => void;
}

export function DateRangeCalendarPicker(props: DateRangeCalendarPickerProps) {
  const { startDate, endDate, onStartChange, onEndChange } = props;

  const startParsed = parseIso(startDate);
  const endParsed = parseIso(endDate);

  const durationDays =
    startParsed && endParsed
      ? Math.max(0, Math.round((endParsed.getTime() - startParsed.getTime()) / (86_400 * 1000)))
      : 0;

  return (
    <div className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-black/20 p-2 transition-all hover:border-[#a855f7]/30 focus-within:border-[#a855f7]/50 focus-within:ring-1 focus-within:ring-[#a855f7]/20">
      <div className="flex w-full items-center gap-3">
        <div className="ml-2 flex shrink-0 items-center justify-center rounded-md bg-white/5 p-1.5 text-[#8f8f95]">
          <Calendar size={14} />
        </div>
        
        <div className="flex w-full items-center gap-2">
          {/* Start Date Container */}
          <div className="relative flex-1 group">
            <div className="flex flex-col items-start px-2 py-1 rounded-md transition-colors group-hover:bg-white/5">
              <span className="text-[9px] font-bold uppercase tracking-widest text-[#8f8f95] mb-0.5">Start Date</span>
              <span className={`text-sm font-semibold tracking-wide ${startDate ? "text-white" : "text-white/30"}`}>
                {formatDate(startDate, "Select")}
              </span>
            </div>
            {/* Invisible Native Input */}
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                const newStart = e.target.value;
                onStartChange(newStart);
                const newParsed = parseIso(newStart);
                if (newParsed && endParsed && newParsed > endParsed) {
                  onEndChange("");
                }
              }}
              onClick={(e) => {
                try {
                  if ('showPicker' in HTMLInputElement.prototype) {
                    e.currentTarget.showPicker();
                  }
                } catch (err) {}
              }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              style={{ colorScheme: 'dark' }}
            />
          </div>

          <ArrowRight size={14} className="shrink-0 text-[#444]" />

          {/* End Date Container */}
          <div className="relative flex-1 group">
            <div className="flex flex-col items-start px-2 py-1 rounded-md transition-colors group-hover:bg-white/5">
              <span className="text-[9px] font-bold uppercase tracking-widest text-[#8f8f95] mb-0.5">End Date</span>
              <span className={`text-sm font-semibold tracking-wide ${endDate ? "text-white" : "text-white/30"}`}>
                {formatDate(endDate, "Select")}
              </span>
            </div>
            {/* Invisible Native Input */}
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => onEndChange(e.target.value)}
              onClick={(e) => {
                try {
                  if ('showPicker' in HTMLInputElement.prototype) {
                    e.currentTarget.showPicker();
                  }
                } catch (err) {}
              }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              style={{ colorScheme: 'dark' }}
            />
          </div>
        </div>
      </div>
      
      {durationDays > 0 && (
        <div className="mr-2 shrink-0">
          <span className="rounded-md border border-[#a855f7]/20 bg-[#a855f7]/10 px-2.5 py-1 text-[10px] font-bold tracking-wide text-[#c084fc]">
            {durationDays}d
          </span>
        </div>
      )}
    </div>
  );
}
