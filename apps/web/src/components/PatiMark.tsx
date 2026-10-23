import type { ComponentProps } from "react";

import patiMarkUrl from "../assets/pati-mark.png";

export function PatiMark(props: ComponentProps<"img">) {
  return <img src={patiMarkUrl} alt="" draggable={false} {...props} />;
}
