import { AlertTriangle } from "lucide-react";

interface DisclaimerBannerProps {
  message?: string;
}

export function DisclaimerBanner({ message }: DisclaimerBannerProps) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
      <p>
        {message ??
          "This platform provides decision support only. Final decisions rest with the relevant regulator."}
      </p>
    </div>
  );
}
