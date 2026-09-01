import type { ReactNode } from "react";
import "./ui.css";

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
};

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="pagehead">
      <div>
        <h1 className="pagehead__title">{title}</h1>
        {description && <p className="pagehead__description">{description}</p>}
      </div>
      {actions && <div className="pagehead__actions">{actions}</div>}
    </header>
  );
}
