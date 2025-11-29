export default {
  rest: {
    defaultLimit: 50,
    maxLimit: 1000, // Increased to allow fetching more items when needed (findMany bypasses this anyway)
    withCount: true,
  },
};
