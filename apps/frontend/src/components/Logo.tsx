import markUrl from "../assets/favicon.svg";

type LogoProps = {
  size?: number;
};

export function Logo({ size = 52 }: LogoProps) {
  return (
    <img
      className="brand__mark"
      src={markUrl}
      width={size}
      height={size}
      alt="Alphractal"
    />
  );
}
