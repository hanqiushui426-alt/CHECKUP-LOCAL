import { useEffect, useRef } from "react";
import * as echarts from "echarts";

export function EChart({ option, height = 320, className }: {
  option: echarts.EChartsOption; height?: number; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    inst.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      inst.current = null;
    };
  }, []);

  useEffect(() => {
    inst.current?.setOption(option, true);
  }, [option]);

  return <div ref={ref} className={className} style={{ height, width: "100%" }} />;
}

// ECharts 支持的中国格式数字
export const fmt = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 });
