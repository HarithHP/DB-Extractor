import { ProjectForm } from "@/components/projects/ProjectForm";
import { PageHeader } from "@/components/ui/misc";

export default function NewProjectPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="New project"
        description="Credentials are signed as an HS256 JWT and encrypted with AES-GCM before touching disk."
      />
      <ProjectForm />
    </div>
  );
}
