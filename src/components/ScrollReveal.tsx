import { useRef } from "react";
import { motion, useInView } from "framer-motion";

const ScrollReveal = ({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div ref={ref} className={className} initial={{ opacity: 0, y: 28 }} animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 28 }} transition={{ duration: .7, delay }}>
      {children}
    </motion.div>
  );
};

export default ScrollReveal;
