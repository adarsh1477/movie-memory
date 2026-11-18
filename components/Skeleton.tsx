export default function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`rounded-lg ${className ?? ""}`}
      style={{
        background:
          "linear-gradient(90deg, #1C1C24 25%, #2A2A35 50%, #1C1C24 75%)",
        backgroundSize: "400% 100%",
        animation: "shimmer 1.8s ease-in-out infinite",
      }}
      aria-hidden="true"
    />
  );
}
