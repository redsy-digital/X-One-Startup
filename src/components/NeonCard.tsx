import React from "react";
import { cn } from "../lib/utils";
import { Card } from "./ui/card";

interface NeonCardProps extends React.ComponentPropsWithoutRef<typeof Card> {
  variant?: "purple" | "blue" | "pink" | "cyan";
  glow?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export const NeonCard = ({ 
  children, 
  className, 
  variant = "purple", 
  glow = true,
  ...props 
}: NeonCardProps) => {
  const glowClass = glow ? {
    purple: "neon-border-purple border-purple-500/50",
    blue: "neon-border-blue border-blue-500/50",
    pink: "shadow-[0_0_10px_rgba(236,72,153,0.5)] border-pink-500/50",
    cyan: "shadow-[0_0_10px_rgba(6,182,212,0.5)] border-cyan-500/50",
  }[variant] : "";

  return (
    <Card 
      className={cn(
        "glass relative overflow-hidden transition-all duration-300",
        glowClass,
        className
      )}
      {...props}
    >
      <div className="relative z-10">
        {children}
      </div>
      {/* Subtle background glow */}
      <div className={cn(
        "absolute -inset-2 opacity-10 blur-2xl pointer-events-none",
        {
          purple: "bg-purple-500",
          blue: "bg-blue-500",
          pink: "bg-pink-500",
          cyan: "bg-cyan-500",
        }[variant]
      )} />
    </Card>
  );
};
