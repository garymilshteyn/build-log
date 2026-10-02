import ProjectItem from './ProjectItem.jsx';

export default function ProjectList({ projects }) {
  return (
    <section aria-labelledby="projects-heading">
      <h2 id="projects-heading">Your projects</h2>
      {projects.length === 0 ? (
        <p>No projects yet. Add your first project above.</p>
      ) : (
        <ul className="project-list">
          {projects.map((project) => <ProjectItem key={project.id} project={project} />)}
        </ul>
      )}
    </section>
  );
}
