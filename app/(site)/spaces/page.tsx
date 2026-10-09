import SpacesBrowser from "@/components/site/SpacesBrowser";
import { T } from "@/components/site/T";

export default function SpacesPage() {
  return (
    <>
      <h1 className="text-3xl font-bold">{T("site.spaces.title")}</h1>
      <p className="mt-2 max-w-3xl text-lg text-muted">{T("site.spaces.sub")}</p>
      <SpacesBrowser />
    </>
  );
}
