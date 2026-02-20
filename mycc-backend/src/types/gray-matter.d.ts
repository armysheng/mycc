declare module 'gray-matter' {
  interface GrayMatterFile<T = Record<string, unknown>> {
    data: T;
    content: string;
    excerpt?: string;
  }

  function matter(input: string): GrayMatterFile;
  export default matter;
}
